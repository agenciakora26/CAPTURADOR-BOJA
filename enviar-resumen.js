import { ejecutarBOJA } from './capturador.js';
import { ejecutarBOE } from './capturador-boe.js';
import { Resend } from 'resend';
import pdfParse from 'pdf-parse';

console.log("INICIO DEL SCRIPT - COMPROBANDO ENTORNO");

// ============================================================
// 1. CONFIGURACIÓN
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
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
// 6. ANALIZAR PDF REAL MEDIANTE EXTRACCIÓN DE TEXTO Y GROQ
// ============================================================

async function analizarPDFConGroq(anuncio) {

    const titulo = String(anuncio.titulo || "").trim();
    const urlPdf = String(anuncio.url_pdf || "").trim();
    const categoria = String(
        anuncio.categoria ||
        anuncio.sector ||
        ""
    ).trim();

    if (!urlPdf) {
        return {
            resumen: "No se ha podido analizar el documento oficial porque no dispone de URL PDF.",
            impacto: "", plazo: "", requisitos: "", accion: "", valor_profesional: ""
        };
    }

    console.log("🤖 ------------------------------------------------");
    console.log(`🤖 Analizando contenido real del PDF con Groq: ${titulo}`);

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

        // Extraemos el texto plano del PDF con pdf-parse
        const datosPdf = await pdfParse(bufferPDF);
        let textoPdf = datosPdf.text ? datosPdf.text.trim() : "";

        if (textoPdf.length < 50) {
            textoPdf = titulo;
        }

        const textoAcotado = textoPdf.substring(0, 10000);

        const prompt = `
Eres el analista experto y redactor jefe de BoletínHoy. 
Tu trabajo es leer el texto extraído de un documento oficial (BOJA o BOE) y redactar un **resumen ejecutivo de alto valor real** para el usuario.

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
- Extensión: Entre 90 y 160 palabras.

RESPONDE EXCLUSIVAMENTE CON UN OBJETO JSON VÁLIDO con esta estructura:
{
    "resumen": "Aquí tu resumen ejecutivo redactado con rigor, datos concretos y utilidad práctica."
}
`;

        const resGroq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: "Devuelves exclusivamente respuestas en JSON estricto." },
                    { role: "user", content: prompt }
                ],
                response_format: { type: "json_object" },
                temperature: 0.2
            })
        });

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
            resultado = JSON.parse(textoRespuesta);
        } catch (jsonError) {
            const limpio = textoRespuesta
                .replace(/^```json/i, "")
                .replace(/^```/i, "")
                .replace(/```$/i, "")
                .trim();
            resultado = JSON.parse(limpio);
        }

        console.log(`✅ Resumen generado con éxito para: ${titulo.substring(0, 40)}...`);

        return {
            resumen: String(resultado.resumen || "").trim(),
            impacto: "", plazo: "", requisitos: "", accion: "", valor_profesional: ""
        };

    } catch (error) {
        console.error(`❌ Error analizando el PDF: ${error.message}`);
        return {
            resumen: `Publicación oficial correspondiente a ${categoria}. ${titulo}. Consulte el enlace oficial para revisar el expediente completo.`,
            impacto: "", plazo: "", requisitos: "", accion: "", valor_profesional: ""
        };
    }
}

// ============================================================
// 7. ENRIQUECER ANUNCIOS CON IA
// ============================================================

async function enriquecerTitulosConIA(anuncios) {
    if (!anuncios || anuncios.length === 0) {
        return anuncios;
    }

    console.log(`🤖 Analizando ${anuncios.length} anuncios mediante Groq...`);
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

        // Breve pausa para fluidez
        await new Promise(resolve => setTimeout(resolve, 300));
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
            "📡 Ejec
