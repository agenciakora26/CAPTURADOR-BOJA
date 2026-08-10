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
// 6. ANALIZAR PDF REAL CON GEMINI
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

        console.log(
            `⚠️ ${titulo} no tiene URL PDF. No se puede analizar el documento.`
        );

        return {
            resumen: "No se ha podido analizar el documento oficial porque no dispone de una URL PDF.",
            impacto: "Revisa el documento original para conocer su alcance.",
            plazo: "",
            accion: ""
        };
    }

    console.log("🤖 ------------------------------------------------");
    console.log(`🤖 Analizando documento con Gemini`);
    console.log(`🤖 Título: ${titulo}`);
    console.log(`🤖 Categoría: ${categoria}`);
    console.log(`🤖 PDF: ${urlPdf}`);

    try {

        // --------------------------------------------------------
        // 6.1 DESCARGAR PDF OFICIAL
        // --------------------------------------------------------

        const respuestaPDF = await fetch(urlPdf, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (compatible; BoletinHoy/1.0; +https://boletinhoy.es)"
            },

            signal: AbortSignal.timeout(30000)
        });

        if (!respuestaPDF.ok) {

            throw new Error(
                `El PDF respondió HTTP ${respuestaPDF.status}`
            );

        }

        const arrayBuffer = await respuestaPDF.arrayBuffer();

        const bufferPDF = Buffer.from(arrayBuffer);

        console.log(
            `📄 PDF descargado: ${Math.round(bufferPDF.length / 1024)} KB`
        );

        if (bufferPDF.length < 1000) {

            throw new Error(
                "El archivo descargado parece demasiado pequeño para ser un PDF válido."
            );

        }


        // --------------------------------------------------------
        // 6.2 CONVERTIR PDF A BASE64
        // --------------------------------------------------------

        const pdfBase64 = bufferPDF.toString("base64");


        // --------------------------------------------------------
        // 6.3 PROMPT DE ANÁLISIS
        // --------------------------------------------------------

        const prompt = `
Eres el analista profesional de BoletínHoy.

Tu trabajo es analizar un documento oficial publicado por el BOJA o el BOE y explicar SU CONTENIDO REAL.

NO hagas un resumen genérico.
NO repitas simplemente el título.
NO digas cosas obvias como "es importante conocer los plazos".
NO inventes información.
NO supongas requisitos, cantidades, fechas o beneficiarios que no aparezcan en el documento.
Si un dato no aparece claramente, no lo inventes.

Analiza el documento completo y extrae la información que realmente pueda ser útil para una persona o empresa interesada en el sector indicado.

DATOS DEL REGISTRO:

Título:
${titulo}

Categoría/sector:
${categoria}

URL oficial:
${urlPdf}


QUIERO QUE ANALICES ESPECIALMENTE:

1. QUÉ SE PUBLICA
Explica de forma clara qué establece realmente el documento.

2. A QUIÉN AFECTA
Identifica quién puede verse afectado:
- empresas
- autónomos
- trabajadores
- opositores
- administraciones
- asociaciones
- entidades
- ciudadanos
- u otros colectivos.

3. QUÉ CAMBIA O QUÉ OPORTUNIDAD EXISTE
Explica la consecuencia práctica de la publicación.

4. PLAZOS Y FECHAS
Si existe un plazo de solicitud, alegaciones, presentación, entrada en vigor, etc., indícalo.
Si aparece una fecha concreta, indícala.
Si no existe un plazo relevante, déjalo vacío.

5. REQUISITOS
Extrae los requisitos realmente relevantes para acceder, participar, cumplir o beneficiarse de lo publicado.

6. IMPORTES / AYUDAS / CONDICIONES ECONÓMICAS
Si existen cantidades, porcentajes, límites, cuantías o condiciones económicas, indícalos.
Si no existen, no inventes nada.

7. QUÉ DEBERÍA HACER EL LECTOR
Da una recomendación práctica basada EXCLUSIVAMENTE en lo que establece el documento.

8. VALOR PROFESIONAL
Explica por qué esta publicación puede ser relevante para alguien suscrito al sector "${categoria}".

IMPORTANTE:

- Prioriza la información accionable.
- No hagas un resumen jurídico interminable.
- No copies párrafos completos del documento.
- No uses lenguaje burocrático innecesario.
- No digas simplemente "se publica una resolución".
- Explica qué significa realmente esa resolución.
- Si se trata de una corrección de errores, explica QUÉ se corrige.
- Si se trata de una convocatoria, explica QUIÉN puede participar, QUÉ se puede conseguir y CUÁNDO.
- Si se trata de una modificación normativa, explica QUÉ cambia respecto a la situación anterior.
- Si se trata de un nombramiento o cese, identifica a la persona y el cargo.
- Si se trata de información pública, explica qué procedimiento se abre y qué puede hacer el interesado.
- Si se trata de contratación pública, identifica el objeto y la oportunidad para empresas.
- Si se trata de una disposición sin una acción directa para el ciudadano o empresa, explícalo igualmente de forma concreta.

RESPONDE EXCLUSIVAMENTE CON JSON VÁLIDO.

Formato obligatorio:

{
  "resumen": "Explicación concreta de qué se publica y qué establece.",
  "impacto": "Explicación práctica de a quién afecta y por qué importa.",
  "plazo": "Fechas o plazos relevantes. Vacío si no existen.",
  "requisitos": "Requisitos relevantes. Vacío si no existen.",
  "accion": "Qué debería hacer el lector si le afecta.",
  "valor_profesional": "Por qué es relevante para el sector."
}
`;


        // --------------------------------------------------------
        // 6.4 LLAMADA REAL A GEMINI
        // --------------------------------------------------------

        const respuestaGemini =
            await ai.models.generateContent({

                model: "gemini-2.5-flash",

                contents: [

                    {
                        role: "user",

                        parts: [

                            {
                                inlineData: {
                                    mimeType: "application/pdf",
                                    data: pdfBase64
                                }
                            },

                            {
                                text: prompt
                            }

                        ]
                    }

                ],

                config: {

                    temperature: 0.2,

                    responseMimeType: "application/json"

                }

            });


        const textoRespuesta =
            respuestaGemini.text;

        console.log(
            "🤖 Respuesta de Gemini recibida."
        );


        if (!textoRespuesta) {

            throw new Error(
                "Gemini no devolvió contenido."
            );

        }


        // --------------------------------------------------------
        // 6.5 PARSEAR JSON
        // --------------------------------------------------------

        let resultado;

        try {

            resultado = JSON.parse(textoRespuesta);

        } catch (jsonError) {

            console.log(
                "⚠️ Gemini no devolvió JSON limpio. Intentando limpiar respuesta..."
            );

            const limpio =
                textoRespuesta
                    .replace(/^```json/i, "")
                    .replace(/^```/i, "")
                    .replace(/```$/i, "")
                    .trim();

            try {

                resultado = JSON.parse(limpio);

            } catch (segundoError) {

                throw new Error(
                    "No se pudo interpretar la respuesta JSON de Gemini."
                );

            }
        }


        // --------------------------------------------------------
        // 6.6 VALIDAR RESULTADO
        // --------------------------------------------------------

        resultado = {

            resumen:
                String(resultado.resumen || "").trim(),

            impacto:
                String(resultado.impacto || "").trim(),

            plazo:
                String(resultado.plazo || "").trim(),

            requisitos:
                String(resultado.requisitos || "").trim(),

            accion:
                String(resultado.accion || "").trim(),

            valor_profesional:
                String(resultado.valor_profesional || "").trim()

        };


        if (!resultado.resumen) {

            throw new Error(
                "Gemini no proporcionó un resumen válido."
            );

        }


        console.log(
            `🤖 Análisis completado: ${titulo}`
        );

        console.log(
            `🤖 Resumen: ${resultado.resumen}`
        );


        return resultado;


    } catch (error) {

        console.error(
            `❌ Error analizando PDF con Gemini: ${error.message}`
        );


        // --------------------------------------------------------
        // FALLBACK
        // --------------------------------------------------------

        return {

            resumen:
                "No se ha podido realizar el análisis automático del documento oficial.",

            impacto:
                "Consulta el documento oficial para conocer su contenido y alcance.",

            plazo:
                "",

            requisitos:
                "",

            accion:
                "Revisa el PDF oficial antes de tomar cualquier decisión.",

            valor_profesional:
                ""

        };
    }
}


// ============================================================
// 7. ENRIQUECER ANUNCIOS CON ANÁLISIS REAL
// ============================================================

async function enriquecerTitulosConIA(anuncios) {

    if (!anuncios || anuncios.length === 0) {

        return anuncios;

    }

    console.log(
        `🤖 Analizando ${anuncios.length} anuncios mediante Gemini...`
    );


    /*
     * Evitamos analizar dos veces el mismo PDF
     * durante una misma ejecución.
     */

    const analisisPorURL = new Map();


    for (const anuncio of anuncios) {

        let titulo =
            String(anuncio.titulo || "").trim();


        /*
         * Limpiar pequeños fragmentos accidentales
         * del principio del título.
         */

        titulo = titulo.replace(
            /^(de|y|la|el|en|por|a)\s+/i,
            ""
        );


        anuncio.titulo = titulo;


        const url =
            String(anuncio.url_pdf || "").trim();


        if (!url) {

            anuncio.resumenIA =
                "No se ha encontrado el PDF oficial asociado a esta publicación.";

            anuncio.analisisIA = {

                resumen:
                    "No se ha encontrado el PDF oficial asociado a esta publicación.",

                impacto:
                    "",

                plazo:
                    "",

                requisitos:
                    "",

                accion:
                    "",

                valor_profesional:
                    ""

            };

            continue;

        }


        /*
         * Si ya hemos analizado esta misma URL
         * reutilizamos el resultado.
         */

        if (analisisPorURL.has(url)) {

            const analisis =
                analisisPorURL.get(url);

            anuncio.analisisIA = analisis;

            anuncio.resumenIA =
                construirResumenVisible(analisis);

            continue;

        }


        const analisis =
            await analizarPDFConGemini(anuncio);


        analisisPorURL.set(
            url,
            analisis
        );


        anuncio.analisisIA =
            analisis;


        anuncio.resumenIA =
            construirResumenVisible(analisis);


        /*
         * Pequeña pausa para evitar lanzar
         * demasiadas peticiones seguidas a Gemini.
         */

        await new Promise(
            resolve => setTimeout(resolve, 500)
        );
    }


    return anuncios;
}


// ============================================================
// 8. CONSTRUIR TEXTO VISIBLE DEL ANÁLISIS
// ============================================================

function construirResumenVisible(analisis) {

    if (!analisis) {

        return "";

    }


    const partes = [];


    if (analisis.resumen) {

        partes.push(
            analisis.resumen
        );

    }


    if (analisis.impacto) {

        partes.push(
            analisis.impacto
        );

    }


    if (analisis.plazo) {

        partes.push(
            `Plazo: ${analisis.plazo}`
        );

    }


    if (analisis.accion) {

        partes.push(
            `Qué hacer: ${analisis.accion}`
        );

    }


    return partes.join(" ");
}


// ============================================================
// 9. PROCESO GLOBAL BOJA + BOE
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
    // 10. OBTENER ANUNCIOS PENDIENTES
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
    // 11. ANALIZAR DOCUMENTOS
    // ========================================================

    const anunciosProcesados =
        await enriquecerTitulosConIA(
            anunciosPendientes
        );


    // ========================================================
    // 12. SEPARAR BOJA / BOE
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
    // 13. OBTENER USUARIOS ACTIVOS
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
    // 14. CONTROL DE ENVÍOS
    // ========================================================

    const anunciosConEnvioCorrecto =
        new Set();


    const destinatariosPorAnuncio =
        new Map();


    const enviosCorrectosPorAnuncio =
        new Map();


    // ========================================================
    // 15. RECORRER USUARIOS
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
            sectoresUsuario.map(
                normalizarTexto
            );


        // ====================================================
        // 16. FILTRAR BOJA
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
        // 17. FILTRAR BOE
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
        // 18. REGISTRAR DESTINATARIOS POR ANUNCIO
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
        // 19. CONTENIDO BOJA
        // ====================================================

        const htmlBojaContent =
            relevantesBoja.length > 0

                ? relevantesBoja.map(r => {

                    const analisis =
                        r.analisisIA || {};


                    return `

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
                            ${escaparHTML(
                                r.categoria ||
                                r.sector ||
                                "BOJA"
                            )}
                        </span>


                        <h4 style="
                            font-size: 15px;
                            color: #1e293b;
                            margin: 10px 0;
                            line-height: 1.4;
                        ">
                            ${escaparHTML(r.titulo)}
                        </h4>


                        <div style="
                            background-color: #f8fafc;
                            border-left: 4px solid #10b981;
                            padding: 12px 15px;
                            margin-top: 10px;
                            border-radius: 4px;
                        ">

                            <strong style="
                                display:block;
                                color: #065f46;
                                font-size: 13px;
                                margin-bottom: 6px;
                            ">
                                💡 Análisis profesional
                            </strong>


                            ${
                                analisis.resumen
                                    ? `
                                    <div style="
                                        color:#374151;
                                        font-size:13px;
                                        line-height:1.55;
                                        margin-bottom:7px;
                                    ">
                                        ${escaparHTML(
                                            analisis.resumen
                                        )}
                                    </div>
                                    `
                                    : ""
                            }


                            ${
                                analisis.impacto
                                    ? `
                                    <div style="
                                        color:#374151;
                                        font-size:13px;
                                        line-height:1.55;
                                        margin-bottom:7px;
                                    ">
                                        <strong>Impacto:</strong>
                                        ${escaparHTML(
                                            analisis.impacto
                                        )}
                                    </div>
                                    `
                                    : ""
                            }


                            ${
                                analisis.plazo
                                    ? `
                                    <div style="
                                        color:#374151;
                                        font-size:13px;
                                        line-height:1.55;
                                        margin-bottom:7px;
                                    ">
                                        <strong>Plazo:</strong>
                                        ${escaparHTML(
                                            analisis.plazo
                                        )}
                                    </div>
                                    `
                                    : ""
                            }


                            ${
                                analisis.requisitos
                                    ? `
                                    <div style="
                                        color:#374151;
                                        font-size:13px;
                                        line-height:1.55;
                                        margin-bottom:7px;
                                    ">
                                        <strong>Requisitos:</strong>
                                        ${escaparHTML(
                                            analisis.requisitos
                                        )}
                                    </div>
                                    `
                                    : ""
                            }


                            ${
                                analisis.accion
                                    ? `
                                    <div style="
                                        color:#374151;
                                        font-size:13px;
                                        line-height:1.55;
                                    ">
                                        <strong>Qué hacer:</strong>
                                        ${escaparHTML(
                                            analisis.accion
                                        )}
                                    </div>
                                    `
                                    : ""
                            }

                        </div>


                        <a
                            href="${escaparHTML(r.url_pdf)}"
                            target="_blank"
                            style="
                                display:inline-block;
                                margin-top:12px;
                                font-size:12px;
                                color:#047857;
                                font-weight:bold;
                                text-decoration:none;
                            "
                        >
                            📄 Ver PDF Oficial &rarr;
                        </a>

                    </div>

                    `;

                }).join("")

                : `

                <p style="
                    font-size: 14px;
                    color: #64748b;
                    font-style: italic;
                    background: #f8fafc;
                    padding: 12px;
                    border-radius: 6px;
                    border: 1px dashed #cbd5e1;
                ">
                    No hay ningún anuncio en esta sección.
                </p>

                `;


        // ====================================================
        // 20. CONTENIDO BOE
        // ====================================================

        const htmlBoeContent =
            relevantesBoe.length > 0

                ? relevantesBoe.map(r => {

                    const analisis =
                        r.analisisIA || {};


                    return `

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
                            ${escaparHTML(
                                r.categoria ||
                                r.sector ||
                                "BOE"
                            )}
                        </span>


                        <h4 style="
                            font-size: 15px;
                            color: #1e293b;
                            margin: 10px 0;
                            line-height: 1.4;
                        ">
                            ${escaparHTML(r.titulo)}
                        </h4>


                        <div style="
                            background: #f8fafc;
                            border: 1px solid #e2e8f0;
                            padding: 12px 15px;
                            margin-bottom: 12px;
                            border-radius: 4px;
                        ">

                            <strong style="
                                display:block;
                                color: #1e40af;
                                font-size: 13px;
                                margin-bottom: 6px;
                            ">
                                💡 Análisis profesional
                            </strong>


                            ${
                                analisis.resumen
                                    ? `
                                    <div style="
                                        color:#334155;
                                        font-size:13px;
                                        line-height:1.55;
                                        margin-bottom:7px;
                                    ">
                                        ${escaparHTML(
                                            analisis.resumen
                                        )}
                                    </div>
                                    `
                                    : ""
                            }


                            ${
                                analisis.impacto
                                    ? `
                                    <div style="
                                        color:#334155;
                                        font-size:13px;
                                        line-height:1.55;
                                        margin-bottom:7px;
                                    ">
                                        <strong>Impacto:</strong>
                                        ${escaparHTML(
                                            analisis.impacto
                                        )}
                                    </div>
                                    `
                                    : ""
                            }


                            ${
                                analisis.plazo
                                    ? `
                                    <div style="
                                        color:#334155;
                                        font-size:13px;
                                        line-height:1.55;
                                        margin-bottom:7px;
                                    ">
                                        <strong>Plazo:</strong>
                                        ${escaparHTML(
                                            analisis.plazo
                                        )}
                                    </div>
                                    `
                                    : ""
                            }


                            ${
                                analisis.requisitos
                                    ? `
                                    <div style="
                                        color:#334155;
                                        font-size:13px;
                                        line-height:1.55;
                                        margin-bottom:7px;
                                    ">
                                        <strong>Requisitos:</strong>
                                        ${escaparHTML(
                                            analisis.requisitos
                                        )}
                                    </div>
                                    `
                                    : ""
                            }


                            ${
                                analisis.accion
                                    ? `
                                    <div style="
                                        color:#334155;
                                        font-size:13px;
                                        line-height:1.55;
                                    ">
                                        <strong>Qué hacer:</strong>
                                        ${escaparHTML(
                                            analisis.accion
                                        )}
                                    </div>
                                    `
                                    : ""
                            }

                        </div>


                        <a
                            href="${escaparHTML(r.url_pdf)}"
                            target="_blank"
                            style="
                                display:inline-block;
                                font-size:12px;
                                color:#1d4ed8;
                                font-weight:bold;
                                text-decoration:none;
                            "
                        >
                            📄 Ver PDF Oficial &rarr;
                        </a>

                    </div>

                    `;

                }).join("")

                : `

                <p style="
                    font-size: 14px;
                    color: #64748b;
                    font-style: italic;
                    background: #f8fafc;
                    padding: 12px;
                    border-radius: 6px;
                    border: 1px dashed #cbd5e1;
                ">
                    No hay ningún anuncio en esta sección.
                </p>

                `;


        // ====================================================
        // 21. EMAIL FINAL
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
                            Hola <strong>${escaparHTML(nombreUsuario)}</strong>,
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
        // 22. ENVIAR EMAIL
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
                `❌ Error al enviar email con Resend a ${usuario.email}:`,
                emailErr.message
            );

        }

    }


    // ========================================================
    // 23. MARCAR COMO ENVIADOS SOLO LOS COMPLETADOS
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


        /*
         * SOLO marcamos enviado=true cuando TODOS
         * los usuarios que deben recibir ese anuncio
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
// 25. EJECUCIÓN
// ============================================================

iniciarProcesoGlobal().catch(err => {

    console.error(
        "❌ Error crítico:",
        err
    );

    process.exit(1);

});
