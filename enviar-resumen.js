import { ejecutarBOJA } from './capturador.js';
import { ejecutarBOE } from './capturador-boe.js';
import { Resend } from 'resend';
import pdfParse from 'pdf-parse';

console.log("INICIO DEL SCRIPT - COMPROBANDO ENTORNO");

// ============================================================
// 1. CONFIGURACIÓN
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

const resend = new Resend(RESEND_API_KEY);

// ============================================================
// 2. FUNCIÓN GENERAL PARA SUPABASE
// ============================================================

async function supabaseRequest(endpoint, opciones = {}) {

    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${endpoint}`,
        {
            ...opciones,

            headers: {
                apikey: SUPABASE_SECRET_KEY,
                Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
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
// ANALISIS DE PDF REAL Y ENRIQUECIMIENTO CON IA (GROQ)
// ============================================================

// ============================================================
// ANALISIS DE PDF REAL Y ENRIQUECIMIENTO CON IA (GROQ)
// ============================================================

const MODELO_GROQ = "openai/gpt-oss-120b";

async function analizarPDFConGroq(anuncio, intento = 1) {
    const titulo = String(anuncio.titulo || "").trim();
    const urlPdf = String(anuncio.url_pdf || "").trim();
    const categoria = String(anuncio.categoria || anuncio.sector || "").trim();

    if (!urlPdf) {
        return {
            resumen: "No se ha podido analizar el documento oficial porque no dispone de URL PDF.",
            impacto: "", plazo: "", requisitos: "", accion: "", valor_profesional: ""
        };
    }

    console.log("🤖 ------------------------------------------------");
    console.log(`🤖 Analizando contenido real del PDF con Groq (Intento ${intento}): ${titulo}`);

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

        if (bufferPDF.length < 1000) {
            throw new Error("El archivo descargado es demasiado pequeño.");
        }

        const datosPdf = await pdfParse(bufferPDF);
        let textoPdf = datosPdf.text ? datosPdf.text.trim() : "";

        if (textoPdf.length < 50) {
            textoPdf = titulo;
        }

        const textoAcotado = textoPdf.substring(0, 8000);

        const prompt = `
Eres el analista experto y redactor jefe de BoletínHoy. 
Tu trabajo es leer el texto extraído de un documento oficial (BOJA o BOE) y redactar un análisis ejecutivo de alto valor real para el usuario.

DATOS DEL DOCUMENTO:
- Título oficial: ${titulo}
- Sector: ${categoria}

TEXTO ÍNTEGRO EXTRAÍDO DEL PDF OFICIAL:
"""
${textoAcotado}
"""

INSTRUCCIONES CLAVE:
- Explica de forma clara, directa y profesional de qué trata exactamente el documento.
- Si es una subvención o ayuda: indica beneficiarios, cuantías, plazos de solicitud u objetivos si figuran en el texto.
- Si es una oposición o empleo público: detalla plazas, requisitos clave o plazos.
- Si es una licitación: explica el objeto del contrato, importe o entidad contratante.
- Si es una notificación o acto administrativo: detalla qué se está notificando y qué implicaciones tiene.
- NUNCA digas frases vacías como "es una publicación oficial" o "consulte el documento". Ve directo a la información útil.

RESPONDE EXCLUSIVAMENTE CON UN OBJETO JSON VÁLIDO (sin texto adicional ni marcas de markdown tipo \`\`\`json) con esta estructura exacta:
{
  "resumen": "Resumen claro y directo de 2 o 3 frases enfocado en lo que importa",
  "impacto": "A quién afecta o qué impacto tiene",
  "plazo": "Plazos indicados o 'No especificado'",
  "requisitos": "Requisitos principales o 'No aplicable'",
  "accion": "Qué acción se debe realizar o 'Informativo'",
  "valor_profesional": "Por qué es relevante para este sector"
}
`;

        const resGroq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: MODELO_GROQ,
                messages: [
                    { role: "system", content: "Devuelves exclusivamente respuestas en JSON estricto." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.1
            })
        });

        if (resGroq.status === 429 && intento <= 3) {
            const esperaMs = intento * 5000;
            console.log(`⚠️ Límite de Groq alcanzado (429). Reintentando en ${esperaMs / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, esperaMs));
            return analizarPDFConGroq(anuncio, intento + 1);
        }

        if (!resGroq.ok) {
            const errText = await resGroq.text();
            throw new Error(`Error HTTP Groq ${resGroq.status}: ${errText}`);
        }

        const data = await resGroq.json();
        const textoRespuesta = data.choices[0]?.message?.content || "";

        if (!textoRespuesta) {
            throw new Error("Groq no devolvió contenido.");
        }

        let resultado;
        try {
            const limpio = textoRespuesta.replace(/```json/gi, "").replace(/```/g, "").trim();
            resultado = JSON.parse(limpio);
        } catch (jsonError) {
            console.warn("⚠️ Error parseando JSON de Groq, aplicando fallback de texto...");
            resultado = {
                resumen: textoRespuesta.substring(0, 300),
                impacto: "", plazo: "", requisitos: "", accion: "", valor_profesional: ""
            };
        }

        console.log(`✅ Resumen generado con éxito para: ${titulo.substring(0, 40)}...`);

        return {
            resumen: String(resultado.resumen || "").trim(),
            impacto: String(resultado.impacto || "").trim(),
            plazo: String(resultado.plazo || "").trim(),
            requisitos: String(resultado.requisitos || "").trim(),
            accion: String(resultado.accion || "").trim(),
            valor_profesional: String(resultado.valor_profesional || "").trim()
        };

    } catch (error) {
        console.error(`❌ Error analizando el PDF: ${error.message}`);
        return {
            resumen: `Publicación oficial correspondiente a ${categoria}. ${titulo}.`,
            impacto: "No disponible por error de análisis",
            plazo: "",
            requisitos: "",
            accion: "",
            valor_profesional: ""
        };
    }
}

async function enriquecerTitulosConIA(anuncios) {
    if (!anuncios || anuncios.length === 0) {
        return anuncios;
    }

    console.log(`🤖 Analizando ${anuncios.length} anuncios mediante Groq (${MODELO_GROQ})...`);
    const analisisPorURL = new Map();

    for (const anuncio of anuncios) {
        let titulo = String(anuncio.titulo || "").trim();
        titulo = titulo.replace(/^(de|y|la|el|en|por|a)\s+/i, "");
        anuncio.titulo = titulo;

        const url = String(anuncio.url_pdf || "").trim();
        if (!url) {
            anuncio.resumenIA = "No se ha encontrado el enlace oficial asociado a esta publicación.";
            anuncio.analisisIA = { resumen: anuncio.resumenIA, impacto: "", plazo: "", requisitos: "", accion: "", valor_profesional: "" };
            continue;
        }

        if (analisisPorURL.has(url)) {
            const analisis = analisisPorURL.get(url);
            anuncio.analisisIA = analisis;
            anuncio.resumenIA = analisis.resumen;
            continue;
        }

        const analisis = await analizarPDFConGroq(anuncio);
        analisisPorURL.set(url, analisis);
        anuncio.analisisIA = analisis;
        anuncio.resumenIA = analisis.resumen;

        // Pausa de 3 segundos entre peticiones para respetar la cuota gratuita
        await new Promise(resolve => setTimeout(resolve, 3000));
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
