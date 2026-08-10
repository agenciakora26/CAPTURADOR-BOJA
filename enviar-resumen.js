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

const ai = new GoogleGenAI({
    apiKey: GEMINI_API_KEY
});

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
// ============================================================

function normalizarTexto(texto) {

    return String(texto || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

// ============================================================
// 4. ESCAPAR HTML
// ============================================================

function escaparHTML(texto) {

    return String(texto || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ============================================================
// 5. NORMALIZAR SECTORES DEL USUARIO
// ============================================================

function obtenerSectoresUsuario(usuario) {

    let sectores = usuario.sectores_suscritos || [];

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
// 6. ANALIZAR PDF REAL CON GEMINI (CON REINTENTOS PARA 429)
// ============================================================

async function analizarPDFConGemini(anuncio) {

    const titulo = String(anuncio.titulo || "").trim();
    const urlPdf = String(anuncio.url_pdf || "").trim();
    const categoria = String(
        anuncio.categoria ||
        anuncio.sector ||
        ""
    ).trim();

    if (!urlPdf) {
        console.log(`⚠️ ${titulo} no tiene URL PDF.`);
        return {
            resumen: "No se ha podido analizar el documento oficial porque no dispone de una URL PDF.",
            impacto: "", plazo: "", requisitos: "", accion: "", valor_profesional: ""
        };
    }

    console.log("🤖 ------------------------------------------------");
    console.log("🤖 Analizando documento con Gemini");
    console.log(`🤖 Título: ${titulo}`);
    console.log(`🤖 Categoría: ${categoria}`);
    console.log(`🤖 PDF: ${urlPdf}`);

    try {
        const respuestaPDF = await fetch(urlPdf, {
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; BoletinHoy/1.0; +https://boletinhoy.es)"
            },
            signal: AbortSignal.timeout(30000)
        });

        if (!respuestaPDF.ok) {
            throw new Error(`El PDF respondió HTTP ${respuestaPDF.status}`);
        }

        const arrayBuffer = await respuestaPDF.arrayBuffer();
        const bufferPDF = Buffer.from(arrayBuffer);

        console.log(`📄 PDF descargado: ${Math.round(bufferPDF.length / 1024)} KB`);

        if (bufferPDF.length < 1000) {
            throw new Error("El archivo descargado parece demasiado pequeño para ser un PDF válido.");
        }

        const pdfBase64 = bufferPDF.toString("base64");

        const prompt = `
Eres el analista profesional de BoletínHoy.
Debes analizar COMPLETAMENTE el documento oficial que se adjunta.
Tu objetivo NO es repetir el título ni describir de forma obvia que se trata de una resolución o anuncio.
Debes INTERPRETAR el contenido real del documento y explicar qué significa para una persona, empresa, autónomo, trabajador o profesional al que pueda afectar.

DATOS DEL DOCUMENTO:
Título: ${titulo}
Sector: ${categoria}
URL oficial: ${urlPdf}

REGLAS IMPORTANTES:
- Lee el documento completo antes de responder.
- No inventes información ni supongas plazos o importes que no aparezcan.
- Explica qué cambia, qué se anuncia, qué se concede, qué se convoca o qué oportunidad existe.
- Si existen fechas, plazos o importes relevantes, intégralos en el resumen.

Extensión aproximada: Entre 80 y 180 palabras.

RESPONDE EXCLUSIVAMENTE CON JSON VÁLIDO con esta estructura:
{
    "resumen": "Resumen ejecutivo profesional, concreto y basado en el contenido real del documento."
}
`;

        // Función auxiliar interna para reintentar si da error 429 de cuota
        const llamarConReintentos = async (maxIntentos = 3) => {
            for (let intento = 1; intento <= maxIntentos; intento++) {
                try {
                    return await ai.models.generateContent({
                        model: "gemini-2.0-flash",
                        contents: [
                            {
                                role: "user",
                                parts: [
                                    { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
                                    { text: prompt }
                                ]
                            }
                        ],
                        config: {
                            temperature: 0.2,
                            responseMimeType: "application/json"
                        }
                    });
                } catch (err) {
                    const esRateLimit = err.message && (err.message.includes("429") || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("quota"));
                    if (esRateLimit && intento < maxIntentos) {
                        const esperaMs = intento * 12000; // Espera progresiva: 12s, 24s...
                        console.log(`⚠️ Cuota de Gemini excedida (429). Reintentando automáticamente en ${esperaMs / 1000}s (Intento ${intento}/${maxIntentos})...`);
                        await new Promise(r => setTimeout(r, esperaMs));
                    } else {
                        throw err;
                    }
                }
            }
        };

        const respuestaGemini = await llamarConReintentos();
        const textoRespuesta = respuestaGemini.text;

        if (!textoRespuesta) {
            throw new Error("Gemini no devolvió contenido.");
        }

        let resultado;
        try {
            resultado = JSON.parse(textoRespuesta);
        } catch (jsonError) {
            const limpio = textoRespuesta
                .replace(/^```json/i, "")
                .replace(/^```/i, "")
                .replace(/```$/i, "")
                .trim();
            resultado = JSON.parse(limpio);
        }

        return {
            resumen: String(resultado.resumen || "").trim(),
            impacto: "", plazo: "", requisitos: "", accion: "", valor_profesional: ""
        };

    } catch (error) {
        console.error(`❌ Error analizando PDF con Gemini: ${error.message}`);
        return {
            resumen: "No se ha podido realizar el análisis automático del documento oficial debido a restricciones temporales de la API.",
            impacto: "", plazo: "", requisitos: "", accion: "", valor_profesional: ""
        };
    }
}

// ============================================================
// 7. ENRIQUECER ANUNCIOS CON IA (CON PAUSA DE SEGURIDAD)
// ============================================================

async function enriquecerTitulosConIA(anuncios) {
    if (!anuncios || anuncios.length === 0) {
        return anuncios;
    }

    console.log(`🤖 Analizando ${anuncios.length} anuncios mediante Gemini...`);
    const analisisPorURL = new Map();

    for (const anuncio of anuncios) {
        let titulo = String(anuncio.titulo || "").trim();
        titulo = titulo.replace(/^(de|y|la|el|en|por|a)\s+/i, "");
        anuncio.titulo = titulo;

        const url = String(anuncio.url_pdf || "").trim();
        if (!url) {
            anuncio.resumenIA = "No se ha encontrado el PDF oficial asociado a esta publicación.";
            anuncio.analisisIA = { resumen: anuncio.resumenIA, impacto: "", plazo: "", requisitos: "", accion: "", valor_profesional: "" };
            continue;
        }

        if (analisisPorURL.has(url)) {
            const analisis = analisisPorURL.get(url);
            anuncio.analisisIA = analisis;
            anuncio.resumenIA = analisis.resumen;
            continue;
        }

        const analisis = await analizarPDFConGemini(anuncio);
        analisisPorURL.set(url, analisis);
        anuncio.analisisIA = analisis;
        anuncio.resumenIA = analisis.resumen;

        // PAUSA DE SEGURIDAD DE 5 SEGUNDOS ENTRE PETICIONES PARA EVITAR EL ERROR 429
        console.log("⏳ Esperando 5 segundos para respetar los límites de la API de Gemini...");
        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    return anuncios;
}
// ============================================================
// 8. PROCESO GLOBAL BOJA + BOE
// ============================================================

async function iniciarProcesoGlobal() {

    console.log(
        "🚀 Iniciando proceso unificado BOJA y BOE..."
    );

    // ========================================================
    // BOJA
    // ========================================================

    try {

        console.log(
            "📡 Ejecutando capturador BOJA..."
        );

        await ejecutarBOJA();

        console.log(
            "✅ Capturador BOJA finalizado."
        );

    } catch (err) {

        console.error(
            "❌ Error en BOJA:",
            err.message
        );

    }

    // ========================================================
    // BOE
    // ========================================================

    try {

        console.log(
            "📡 Ejecutando capturador BOE..."
        );

        await ejecutarBOE();

        console.log(
            "✅ Capturador BOE finalizado."
        );

    } catch (err) {

        console.error(
            "❌ Error en BOE:",
            err.message
        );

    }

    // ========================================================
    // OBTENER ANUNCIOS PENDIENTES
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
            "📭 No hay anuncios pendientes."
        );

        return;

    }

    console.log(
        `📌 Encontrados ${anunciosPendientes.length} anuncios pendientes.`
    );

    // ========================================================
    // ANALIZAR DOCUMENTOS
    // ========================================================

    const anunciosProcesados =
        await enriquecerTitulosConIA(
            anunciosPendientes
        );

    // ========================================================
    // SEPARAR BOJA / BOE
    // ========================================================

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
    // OBTENER USUARIOS
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

        return;

    }

    console.log(
        `👥 Usuarios activos encontrados: ${usuarios.length}`
    );

    // ========================================================
    // CONTROL DE ENVÍOS
    // ========================================================

    const anunciosConEnvioCorrecto =
        new Set();

    const destinatariosPorAnuncio =
        new Map();

    const enviosCorrectosPorAnuncio =
        new Map();

    // ========================================================
    // RECORRER USUARIOS
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

            continue;

        }

        const sectoresNormalizados =
            sectoresUsuario.map(
                normalizarTexto
            );

        // ====================================================
        // FILTRAR BOJA
        // ====================================================

        const relevantesBoja =
            documentosBoja.filter(doc => {

                const categoria =
                    doc.categoria ||
                    doc.sector ||
                    "";

                return sectoresNormalizados.includes(
                    normalizarTexto(categoria)
                );

            });

        // ====================================================
        // FILTRAR BOE
        // ====================================================

        const relevantesBoe =
            documentosBoe.filter(doc => {

                const categoria =
                    doc.categoria ||
                    doc.sector ||
                    "";

                return sectoresNormalizados.includes(
                    normalizarTexto(categoria)
                );

            });

        const totalAlertas =
            relevantesBoja.length +
            relevantesBoe.length;

        if (totalAlertas === 0) {

            console.log(
                `ℹ️ ${usuario.email} no tiene alertas correspondientes.`
            );

            continue;

        }

        // ====================================================
        // REGISTRAR DESTINATARIOS
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
        // 19. CREAR TARJETAS DE BOJA
        // ====================================================

        const htmlBojaContent =
            relevantesBoja.length > 0

                ? relevantesBoja.map(r => {

                    const analisis =
                        r.analisisIA || {};

                    return `

                    <div style="
                        background:#ffffff;
                        border:1px solid #e2e8f0;
                        border-left:4px solid #10b981;
                        padding:18px;
                        margin-bottom:18px;
                        border-radius:8px;
                    ">

                        <div style="
                            font-size:11px;
                            font-weight:bold;
                            color:#047857;
                            text-transform:uppercase;
                            margin-bottom:8px;
                        ">
                            ${escaparHTML(
                                r.categoria ||
                                r.sector ||
                                "BOJA"
                            )}
                        </div>

                        <div style="
                            font-size:11px;
                            font-weight:bold;
                            color:#64748b;
                            text-transform:uppercase;
                            letter-spacing:.3px;
                            margin-bottom:6px;
                        ">
                            Anuncio oficial
                        </div>

                        <h4 style="
                            font-size:16px;
                            color:#1e293b;
                            margin:0 0 16px 0;
                            line-height:1.5;
                        ">
                            ${escaparHTML(r.titulo)}
                        </h4>

                        <div style="
                            background:#f8fafc;
                            border-radius:6px;
                            padding:14px;
                            margin-bottom:15px;
                        ">

                            <div style="
                                font-size:11px;
                                font-weight:bold;
                                color:#047857;
                                text-transform:uppercase;
                                margin-bottom:7px;
                            ">
                                Resumen ejecutivo
                            </div>

                            <div style="
                                color:#334155;
                                font-size:14px;
                                line-height:1.65;
                            ">
                                ${escaparHTML(
                                    analisis.resumen ||
                                    "No se ha podido generar el resumen ejecutivo."
                                )}
                            </div>

                        </div>

                        <a
                            href="${escaparHTML(r.url_pdf)}"
                            target="_blank"
                            style="
                                display:inline-block;
                                background:#047857;
                                color:#ffffff;
                                padding:9px 14px;
                                border-radius:5px;
                                font-size:12px;
                                font-weight:bold;
                                text-decoration:none;
                            "
                        >
                            📄 Ver PDF oficial →
                        </a>

                    </div>

                    `;

                }).join("")

                : "";

        // ====================================================
        // 20. CREAR TARJETAS DE BOE
        // ====================================================

        const htmlBoeContent =
            relevantesBoe.length > 0

                ? relevantesBoe.map(r => {

                    const analisis =
                        r.analisisIA || {};

                    return `

                    <div style="
                        background:#ffffff;
                        border:1px solid #e2e8f0;
                        border-left:4px solid #3b82f6;
                        padding:18px;
                        margin-bottom:18px;
                        border-radius:8px;
                    ">

                        <div style="
                            font-size:11px;
                            font-weight:bold;
                            color:#1d4ed8;
                            text-transform:uppercase;
                            margin-bottom:8px;
                        ">
                            ${escaparHTML(
                                r.categoria ||
                                r.sector ||
                                "BOE"
                            )}
                        </div>

                        <div style="
                            font-size:11px;
                            font-weight:bold;
                            color:#64748b;
                            text-transform:uppercase;
                            letter-spacing:.3px;
                            margin-bottom:6px;
                        ">
                            Anuncio oficial
                        </div>

                        <h4 style="
                            font-size:16px;
                            color:#1e293b;
                            margin:0 0 16px 0;
                            line-height:1.5;
                        ">
                            ${escaparHTML(r.titulo)}
                        </h4>

                        <div style="
                            background:#f8fafc;
                            border-radius:6px;
                            padding:14px;
                            margin-bottom:15px;
                        ">

                            <div style="
                                font-size:11px;
                                font-weight:bold;
                                color:#1d4ed8;
                                text-transform:uppercase;
                                margin-bottom:7px;
                            ">
                                Resumen ejecutivo
                            </div>

                            <div style="
                                color:#334155;
                                font-size:14px;
                                line-height:1.65;
                            ">
                                ${escaparHTML(
                                    analisis.resumen ||
                                    "No se ha podido generar el resumen ejecutivo."
                                )}
                            </div>

                        </div>

                        <a
                            href="${escaparHTML(r.url_pdf)}"
                            target="_blank"
                            style="
                                display:inline-block;
                                background:#1d4ed8;
                                color:#ffffff;
                                padding:9px 14px;
                                border-radius:5px;
                                font-size:12px;
                                font-weight:bold;
                                text-decoration:none;
                            "
                        >
                            📄 Ver PDF oficial →
                        </a>

                    </div>

                    `;

                }).join("")

                : "";

        // ====================================================
        // 21. EMAIL FINAL
        // ====================================================

        const htmlFinal = `

            <div style="
                font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                background:#f8fafc;
                padding:30px 20px;
                color:#334155;
            ">

                <div style="
                    max-width:600px;
                    margin:0 auto;
                    background:#ffffff;
                    border-radius:8px;
                    overflow:hidden;
                    border:1px solid #e2e8f0;
                ">

                    <div style="
                        background:#0f172a;
                        padding:20px;
                        text-align:center;
                    ">

                        <h2 style="
                            color:#ffffff;
                            margin:0;
                            font-size:20px;
                        ">
                            Resumen Diario Oficial
                        </h2>

                        <p style="
                            color:#94a3b8;
                            font-size:13px;
                            margin:5px 0 0 0;
                        ">
                            Tus alertas personalizadas
                        </p>

                    </div>

                    <div style="padding:25px;">

                        <p style="
                            font-size:16px;
                            color:#334155;
                            margin-top:0;
                        ">
                            Hola <strong>${escaparHTML(nombreUsuario)}</strong>,
                        </p>

                        <p style="
                            font-size:15px;
                            color:#334155;
                        ">
                            Hemos detectado
                            <strong>${totalAlertas} novedades</strong>
                            relacionadas con tus sectores suscritos.
                        </p>

                        ${
                            relevantesBoja.length > 0
                                ? `
                                <h3 style="
                                    color:#047857;
                                    font-size:16px;
                                    border-bottom:2px solid #10b981;
                                    padding-bottom:5px;
                                    margin-top:25px;
                                ">
                                    🟢 Junta de Andalucía (BOJA)
                                </h3>

                                ${htmlBojaContent}
                                `
                                : ""
                        }

                        ${
                            relevantesBoe.length > 0
                                ? `
                                <h3 style="
                                    color:#1d4ed8;
                                    font-size:16px;
                                    border-bottom:2px solid #3b82f6;
                                    padding-bottom:5px;
                                    margin-top:25px;
                                ">
                                    🔵 Estado (BOE)
                                </h3>

                                ${htmlBoeContent}
                                `
                                : ""
                        }

                    </div>

                    <div style="
                        background:#f1f5f9;
                        padding:15px;
                        text-align:center;
                        border-top:1px solid #e2e8f0;
                    ">

                        <p style="
                            font-size:12px;
                            color:#64748b;
                            margin:0;
                        ">
                            BoletínHoy | Tu resumen diario.
                        </p>

                    </div>

                </div>

            </div>

        `;

        // ====================================================
        // 22. ENVIAR EMAIL
        // ====================================================

        try {

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

            // =================================================
            // REGISTRAR ENVÍOS CORRECTOS
            // =================================================

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
                `❌ Error enviando email a ${usuario.email}:`,
                emailErr.message
            );

        }
    }

    // ========================================================
    // 23. MARCAR COMO ENVIADOS
    // ========================================================

    console.log(
        "🔄 Comprobando qué anuncios se pueden marcar como enviados..."
    );

    for (
        const [
            anuncioId,
            destinatarios
        ]
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
                `⏳ Anuncio ${anuncioId} permanece en enviado=false.`
            );

        }
    }

    // ========================================================
    // 24. RESUMEN FINAL
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
        `⏳ Anuncios pendientes: ${
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
// 25. EJECUCIÓN
// ============================================================

iniciarProcesoGlobal().catch(err => {

    console.error(
        "❌ Error crítico:",
        err
    );

    process.exit(1);

});
