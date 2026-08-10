import { ejecutarBOJA } from './capturador.js';
import { ejecutarBOE } from './capturador-boe.js';
import { Resend } from 'resend';
import { GoogleGenAI } from '@google/genai';

console.log("INICIO DEL SCRIPT - COMPROBANDO ENTORNO");


// ============================================================
// 1. CONFIGURACIÓN
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const resend = new Resend(RESEND_API_KEY);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });


// ============================================================
// 2. FUNCIÓN GENERAL PARA SUPABASE
// ============================================================

async function supabaseRequest(endpoint, opciones = {}) {

    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${endpoint}`,
        {
            ...opciones,

            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
                "Content-Type": "application/json",
                ...(opciones.headers || {})
            }
        }
    );

    if (!res.ok) {
        throw new Error(
            `Supabase error: ${res.status} - ${await res.text()}`
        );
    }

    const text = await res.text();

    return text ? JSON.parse(text) : null;
}


// ============================================================
// 3. NORMALIZAR TEXTO
//    Permite comparar categorías aunque haya diferencias
//    de mayúsculas, espacios o tildes.
// ============================================================

function normalizarTexto(texto) {

    return String(texto || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}


// ============================================================
// 4. NORMALIZAR SECTORES DEL USUARIO
// ============================================================

function obtenerSectoresUsuario(usuario) {

    let sectores = usuario.sectores_suscritos || [];

    // Si Supabase devuelve un JSON como texto
    if (typeof sectores === "string") {

        try {
            sectores = JSON.parse(sectores);
        } catch (error) {
            sectores = [sectores];
        }
    }

    if (!Array.isArray(sectores)) {
        sectores = [sectores];
    }

    return sectores
        .filter(Boolean)
        .map(s => String(s).trim())
        .filter(Boolean);
}


// ============================================================
// 5. ENRIQUECIMIENTO DE TÍTULOS
// ============================================================

async function enriquecerTitulosConIA(anuncios) {

    if (!anuncios || anuncios.length === 0) {
        return anuncios;
    }

    console.log(
        `⚡ Generando resúmenes de alto valor profesional para ${anuncios.length} anuncios...`
    );

    anuncios.forEach(a => {

        let titulo = (a.titulo || "").trim();

        // Limpiamos fragmentos huérfanos al inicio
        titulo = titulo.replace(
            /^(de|y|la|el|en|por|a)\s+/i,
            ""
        );

        a.titulo = titulo;

        const tLower = titulo.toLowerCase();

        let beneficio =
            "Documento oficial de relevancia para la gestión y normativa del sector.";

        if (
            tLower.includes("nombr") ||
            tLower.includes("cese") ||
            tLower.includes("personal")
        ) {

            beneficio =
                "Modificación de personal o altos cargos. Esencial para conocer interlocutores y cambios en la estructura directiva.";

        } else if (
            tLower.includes("subvenc") ||
            tLower.includes("ayuda") ||
            tLower.includes("bases reguladoras")
        ) {

            beneficio =
                "Nueva línea de financiación o fondos públicos. Clave para evaluar plazos, requisitos y solicitud de incentivos.";

        } else if (
            tLower.includes("oposic") ||
            tLower.includes("empleo") ||
            tLower.includes("aspirantes") ||
            tLower.includes("plazas")
        ) {

            beneficio =
                "Convocatoria de empleo público o listados de selección. Vital para aspirantes y seguimiento de procesos selectivos.";

        } else if (
            tLower.includes("corrección de errores") ||
            tLower.includes("erratas")
        ) {

            beneficio =
                "Subsanación de errores en disposiciones anteriores. Importante para asegurar la seguridad jurídica de los datos correctos.";

        } else if (
            tLower.includes("información pública") ||
            tLower.includes("somete") ||
            tLower.includes("autorización ambiental")
        ) {

            beneficio =
                "Apertura de plazo para alegaciones ciudadanas o empresariales. Oportunidad clave para revisar proyectos o presentar oposiciones.";

        } else if (
            tLower.includes("contrat") ||
            tLower.includes("licitacion") ||
            tLower.includes("adjudicacion")
        ) {

            beneficio =
                "Expediente de contratación pública. Interesante para empresas y autónomos que buscan licitar con la administración.";
        }

        a.resumenIA = beneficio;
    });

    return anuncios;
}


// ============================================================
// 6. PROCESO GLOBAL BOJA + BOE
// ============================================================

async function iniciarProcesoGlobal() {

    console.log("🚀 Iniciando proceso unificado BOJA y BOE...");

    try {

        console.log("📡 Ejecutando capturador BOJA...");

        await ejecutarBOJA();

        console.log("✅ Capturador BOJA finalizado.");

    } catch (err) {

        console.error(
            "❌ Error en BOJA:",
            err.message
        );
    }


    try {

        console.log("📡 Ejecutando capturador BOE...");

        await ejecutarBOE();

        console.log("✅ Capturador BOE finalizado.");

    } catch (err) {

        console.error(
            "❌ Error en BOE:",
            err.message
        );
    }


    // ========================================================
    // 7. OBTENER ANUNCIOS PENDIENTES
    // ========================================================

    console.log(
        "📥 Consultando anuncios pendientes en Supabase..."
    );

    const anunciosPendientes =
        await supabaseRequest(
            "anuncios_boja?enviado=eq.false&select=*"
        );


    if (
        !anunciosPendientes ||
        anunciosPendientes.length === 0
    ) {

        console.log(
            "📭 No hay anuncios pendientes con enviado=false en Supabase."
        );

        return;
    }


    console.log(
        `📌 Encontrados ${anunciosPendientes.length} anuncios pendientes en base de datos. Procesando...`
    );


    // ========================================================
    // 8. PREPARAR ANUNCIOS
    // ========================================================

    const anunciosProcesados =
        await enriquecerTitulosConIA(
            anunciosPendientes
        );


    const documentosBoja =
        anunciosProcesados.filter(
            d =>
                d.origen === "BOJA" ||
                !d.origen
        );


    const documentosBoe =
        anunciosProcesados.filter(
            d =>
                d.origen === "BOE"
        );


    console.log(
        `🟢 BOJA pendientes: ${documentosBoja.length}`
    );

    console.log(
        `🔵 BOE pendientes: ${documentosBoe.length}`
    );


    // ========================================================
    // 9. OBTENER USUARIOS ACTIVOS
    // ========================================================

    console.log(
        "👥 Consultando usuarios suscritos..."
    );

    const usuarios =
        await supabaseRequest(
            "perfiles_usuarios?select=email,sectores_suscritos&estado_suscripcion=eq.activa"
        );


    if (
        !usuarios ||
        usuarios.length === 0
    ) {

        console.log(
            "⚠️ No hay usuarios activos."
        );

        console.log(
            "ℹ️ Los anuncios permanecerán con enviado=false."
        );

        return;
    }


    console.log(
        `👥 Usuarios activos encontrados: ${usuarios.length}`
    );


    // ========================================================
    // 10. CONTROL DE ENVÍOS
    // ========================================================

    /*
     * Guardamos qué anuncios han sido enviados correctamente.
     *
     * IMPORTANTE:
     * No marcamos un anuncio como enviado simplemente porque
     * haya sido procesado.
     */

    const anunciosConEnvioCorrecto = new Set();

    /*
     * También guardamos cuántos usuarios deberían recibir
     * cada anuncio y cuántos lo han recibido correctamente.
     */

    const destinatariosPorAnuncio = new Map();

    const enviosCorrectosPorAnuncio = new Map();


    // ========================================================
    // 11. RECORRER USUARIOS
    // ========================================================

    for (const usuario of usuarios) {

        const sectoresUsuario =
            obtenerSectoresUsuario(usuario);


        console.log(
            `👤 ${usuario.email} → Sectores:`,
            sectoresUsuario
        );


        if (
            !sectoresUsuario ||
            sectoresUsuario.length === 0
        ) {

            console.log(
                `⚠️ ${usuario.email} no tiene sectores suscritos.`
            );

            continue;
        }


        const sectoresNormalizados =
            sectoresUsuario.map(normalizarTexto);


        // ====================================================
        // 12. FILTRAR BOJA PARA ESTE USUARIO
        // ====================================================

        const relevantesBoja =
            documentosBoja.filter(doc => {

                const categoria =
                    doc.categoria ||
                    doc.sector ||
                    "";

                const categoriaNormalizada =
                    normalizarTexto(categoria);

                return sectoresNormalizados.includes(
                    categoriaNormalizada
                );
            });


        // ====================================================
        // 13. FILTRAR BOE PARA ESTE USUARIO
        // ====================================================

        const relevantesBoe =
            documentosBoe.filter(doc => {

                const categoria =
                    doc.categoria ||
                    doc.sector ||
                    "";

                const categoriaNormalizada =
                    normalizarTexto(categoria);

                return sectoresNormalizados.includes(
                    categoriaNormalizada
                );
            });


        const totalAlertas =
            relevantesBoja.length +
            relevantesBoe.length;


        if (totalAlertas === 0) {

            console.log(
                `ℹ️ ${usuario.email} no tiene alertas correspondientes a sus sectores.`
            );

            continue;
        }


        // ====================================================
        // 14. REGISTRAR DESTINATARIOS POR ANUNCIO
        // ====================================================

        [
            ...relevantesBoja,
            ...relevantesBoe
        ].forEach(anuncio => {

            if (!anuncio.id) {
                return;
            }

            if (
                !destinatariosPorAnuncio.has(
                    anuncio.id
                )
            ) {

                destinatariosPorAnuncio.set(
                    anuncio.id,
                    new Set()
                );
            }

            destinatariosPorAnuncio
                .get(anuncio.id)
                .add(usuario.email);
        });


        const nombreUsuario =
            usuario.email.split("@")[0];


        console.log(
            `📧 Preparando resumen para ${usuario.email} (${totalAlertas} alertas)...`
        );


        // ====================================================
        // 15. CONTENIDO BOJA
        // ====================================================

        const htmlBojaContent =
            relevantesBoja.length > 0

                ? relevantesBoja.map(r => `
                    <div style="
                        background: #ffffff;
                        border: 1px solid #e2e8f0;
                        border-left: 4px solid #10b981;
                        padding: 15px;
                        margin-bottom: 15px;
                        border-radius: 6px;
                    ">

                        <span style="
                            font-size: 11px;
                            font-weight: bold;
                            background: #ecfdf5;
                            color: #047857;
                            padding: 3px 8px;
                            border-radius: 4px;
                            text-transform: uppercase;
                        ">
                            ${r.categoria || r.sector || "BOJA"}
                        </span>

                        <h4 style="
                            font-size: 15px;
                            color: #1e293b;
                            margin: 10px 0;
                            line-height: 1.4;
                        ">
                            ${r.titulo}
                        </h4>

                        <div style="
                            background-color: #f8f9fa;
                            border-left: 4px solid #10b981;
                            padding: 10px 15px;
                            margin-top: 10px;
                            border-radius: 4px;
                        ">

                            <strong style="
                                color: #065f46;
                                font-size: 13px;
                            ">
                                💡 Impacto Profesional:
                            </strong>

                            <span style="
                                color: #374151;
                                font-size: 13px;
                            ">
                                ${r.resumenIA || r.titulo}
                            </span>

                        </div>

                        <a
                            href="${r.url_pdf}"
                            target="_blank"
                            style="
                                font-size: 12px;
                                color: #047857;
                                font-weight: bold;
                                text-decoration: none;
                            "
                        >
                            📄 Ver PDF Oficial &rarr;
                        </a>

                    </div>
                `).join("")

                : `<p style="
                    font-size: 14px;
                    color: #64748b;
                    font-style: italic;
                    background: #f8fafc;
                    padding: 12px;
                    border-radius: 6px;
                    border: 1px dashed #cbd5e1;
                ">
                    No hay ningún anuncio en esta sección.
                </p>`;


        // ====================================================
        // 16. CONTENIDO BOE
        // ====================================================

        const htmlBoeContent =
            relevantesBoe.length > 0

                ? relevantesBoe.map(r => `
                    <div style="
                        background: #ffffff;
                        border: 1px solid #e2e8f0;
                        border-left: 4px solid #3b82f6;
                        padding: 15px;
                        margin-bottom: 15px;
                        border-radius: 6px;
                    ">

                        <span style="
                            font-size: 11px;
                            font-weight: bold;
                            background: #eff6ff;
                            color: #1d4ed8;
                            padding: 3px 8px;
                            border-radius: 4px;
                            text-transform: uppercase;
                        ">
                            ${r.categoria || r.sector || "BOE"}
                        </span>

                        <h4 style="
                            font-size: 15px;
                            color: #1e293b;
                            margin: 10px 0;
                            line-height: 1.4;
                        ">
                            ${r.titulo}
                        </h4>

                        <div style="
                            background: #f8fafc;
                            border: 1px solid #e2e8f0;
                            padding: 10px 12px;
                            margin-bottom: 12px;
                            border-radius: 4px;
                        ">

                            <strong style="
                                color: #1e40af;
                                font-size: 13px;
                            ">
                                💡 Impacto Profesional:
                            </strong>

                            <span style="
                                color: #334155;
                                font-size: 13px;
                            ">
                                ${r.resumenIA || r.titulo}
                            </span>

                        </div>

                        <a
                            href="${r.url_pdf}"
                            target="_blank"
                            style="
                                font-size: 12px;
                                color: #1d4ed8;
                                font-weight: bold;
                                text-decoration: none;
                            "
                        >
                            📄 Ver PDF Oficial &rarr;
                        </a>

                    </div>
                `).join("")

                : `<p style="
                    font-size: 14px;
                    color: #64748b;
                    font-style: italic;
                    background: #f8fafc;
                    padding: 12px;
                    border-radius: 6px;
                    border: 1px dashed #cbd5e1;
                ">
                    No hay ningún anuncio en esta sección.
                </p>`;


        // ====================================================
        // 17. EMAIL FINAL
        // ====================================================

        const htmlFinal = `

            <div style="
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                background-color: #f8fafc;
                padding: 30px 20px;
                color: #334155;
            ">

                <div style="
                    max-width: 600px;
                    margin: 0 auto;
                    background: #ffffff;
                    border-radius: 8px;
                    overflow: hidden;
                    border: 1px solid #e2e8f0;
                ">

                    <div style="
                        background: #0f172a;
                        padding: 20px;
                        text-align: center;
                    ">

                        <h2 style="
                            color: #ffffff;
                            margin: 0;
                            font-size: 20px;
                        ">
                            Resumen Diario Oficial
                        </h2>

                        <p style="
                            color: #94a3b8;
                            font-size: 13px;
                            margin: 5px 0 0 0;
                        ">
                            Tus alertas personalizadas
                        </p>

                    </div>


                    <div style="padding: 25px;">

                        <p style="
                            font-size: 16px;
                            color: #334155;
                            margin-top: 0;
                        ">
                            Hola <strong>${nombreUsuario}</strong>,
                        </p>

                        <p style="
                            font-size: 15px;
                            color: #334155;
                        ">
                            Aquí tienes el desglose de las
                            <strong>${totalAlertas} novedades</strong>
                            de hoy:
                        </p>


                        <h3 style="
                            color: #047857;
                            font-size: 16px;
                            border-bottom: 2px solid #10b981;
                            padding-bottom: 5px;
                            margin-top: 25px;
                        ">
                            🟢 Junta de Andalucía (BOJA)
                        </h3>

                        ${htmlBojaContent}


                        <h3 style="
                            color: #1d4ed8;
                            font-size: 16px;
                            border-bottom: 2px solid #3b82f6;
                            padding-bottom: 5px;
                            margin-top: 25px;
                        ">
                            🔵 Estado (BOE)
                        </h3>

                        ${htmlBoeContent}

                    </div>


                    <div style="
                        background: #f1f5f9;
                        padding: 15px;
                        text-align: center;
                        border-top: 1px solid #e2e8f0;
                    ">

                        <p style="
                            font-size: 12px;
                            color: #64748b;
                            margin: 0;
                        ">
                            BoletínHoy | Tu resumen diario.
                        </p>

                    </div>

                </div>

            </div>

        `;


        // ====================================================
        // 18. ENVIAR EMAIL
        // ====================================================

        try {

            const resultadoEmail =
                await resend.emails.send({

                    from:
                        'BoletínHoy <alertas@boletinhoy.es>',

                    to:
                        [usuario.email],

                    subject:
                        `Resumen Personalizado: ${totalAlertas} nuevas alertas`,

                    html:
                        htmlFinal
                });


            console.log(
                `✅ Correo enviado con éxito a ${usuario.email}`
            );


            /*
             * Registramos que este usuario ha recibido
             * correctamente sus anuncios.
             */

            [
                ...relevantesBoja,
                ...relevantesBoe
            ].forEach(anuncio => {

                if (!anuncio.id) {
                    return;
                }

                if (
                    !enviosCorrectosPorAnuncio.has(
                        anuncio.id
                    )
                ) {

                    enviosCorrectosPorAnuncio.set(
                        anuncio.id,
                        new Set()
                    );
                }

                enviosCorrectosPorAnuncio
                    .get(anuncio.id)
                    .add(usuario.email);
            });


        } catch (emailErr) {

            console.error(
                `❌ Error al enviar email con Resend a ${usuario.email}:`,
                emailErr.message
            );

            /*
             * IMPORTANTE:
             * No marcamos los anuncios como enviados.
             *
             * Permanecerán en enviado=false para
             * poder volver a procesarlos.
             */
        }
    }


    // ========================================================
    // 19. MARCAR COMO ENVIADOS SOLO LOS COMPLETADOS
    // ========================================================

    console.log(
        "🔄 Comprobando qué anuncios se pueden marcar como enviados..."
    );


    for (
        const [anuncioId, destinatarios]
        of destinatariosPorAnuncio.entries()
    ) {

        const enviosCorrectos =
            enviosCorrectosPorAnuncio.get(
                anuncioId
            ) || new Set();


        const totalDestinatarios =
            destinatarios.size;


        const totalEnviados =
            enviosCorrectos.size;


        console.log(
            `📊 Anuncio ${anuncioId}: ${totalEnviados}/${totalDestinatarios} destinatarios recibidos correctamente.`
        );


        /*
         * SOLO marcamos enviado=true cuando TODOS los
         * usuarios que debían recibir ese anuncio
         * lo han recibido correctamente.
         */

        if (
            totalDestinatarios > 0 &&
            totalEnviados === totalDestinatarios
        ) {

            try {

                await supabaseRequest(
                    `anuncios_boja?id=eq.${anuncioId}`,
                    {
                        method: "PATCH",

                        body: JSON.stringify({
                            enviado: true
                        })
                    }
                );


                anunciosConEnvioCorrecto.add(
                    anuncioId
                );


                console.log(
                    `✅ Anuncio ${anuncioId} marcado como enviado=true`
                );


            } catch (patchErr) {

                console.error(
                    `❌ No se pudo actualizar enviado para el anuncio ${anuncioId}:`,
                    patchErr.message
                );
            }


        } else {

            console.log(
                `⏳ Anuncio ${anuncioId} permanece en enviado=false porque no todos los destinatarios lo recibieron.`
            );
        }
    }


    // ========================================================
    // 20. RESUMEN FINAL
    // ========================================================

    console.log(
        "======================================"
    );

    console.log(
        `📊 Anuncios procesados: ${anunciosProcesados.length}`
    );

    console.log(
        `📨 Anuncios completamente enviados: ${anunciosConEnvioCorrecto.size}`
    );

    console.log(
        `⏳ Anuncios pendientes de envío: ${
            anunciosProcesados.length -
            anunciosConEnvioCorrecto.size
        }`
    );

    console.log(
        "======================================"
    );

    console.log(
        "✅ Proceso completado con éxito."
    );
}


// ============================================================
// 21. EJECUCIÓN
// ============================================================

iniciarProcesoGlobal().catch(err => {

    console.error(
        "❌ Error crítico:",
        err
    );

    process.exit(1);
});
