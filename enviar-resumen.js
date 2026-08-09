import { ejecutarBOJA } from './capturador.js';
import { ejecutarBOE } from './capturador-boe.js';
import { Resend } from 'resend';
import { GoogleGenAI } from '@google/genai';

console.log("INICIO DEL SCRIPT - COMPROBANDO ENTORNO");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const resend = new Resend(RESEND_API_KEY);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

async function supabaseRequest(endpoint, opciones = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...opciones,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(opciones.headers || {})
    }
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} - ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function enriquecerTitulosConIA(anuncios) {
  if (!anuncios || anuncios.length === 0 || !GEMINI_API_KEY) return anuncios;

  const listaParaIA = anuncios.map((a, index) => ({ id: index, texto: a.titulo }));

  const prompt = `
    Eres un experto en comunicación clara. Para cada uno de los siguientes anuncios oficiales, genera un resumen muy sencillo, claro y directo que explique por qué le puede interesar a un profesional.
    
    Devuelve la respuesta EXCLUSIVAMENTE en formato de array JSON válido, sin bloques de código ni texto adicional, con esta estructura exacta:
    [
      {"id": 0, "resumen": "Resumen claro y directo de 1 o 2 líneas explicando por qué interesa"}
    ]

    Anuncios a procesar:
    ${JSON.stringify(listaParaIA)}
  `;

  try {
    console.log("🤖 Generando resúmenes estructurados con Gemini...");
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
    });

    let textoRespuesta = response.text.trim();
    // Limpieza segura sin expresiones regulares frágiles
    if (textoRespuesta.startsWith("```json")) {
      textoRespuesta = textoRespuesta.replace("```json", "");
    }
    if (textoRespuesta.startsWith("```")) {
      textoRespuesta = textoRespuesta.replace("```", "");
    }
    if (textoRespuesta.endsWith("```")) {
      textoRespuesta = textoRespuesta.slice(0, -3);
    }
    textoRespuesta = textoRespuesta.trim();

    const jsonRespuetas = JSON.parse(textoRespuesta);
    
    jsonRespuetas.forEach(item => {
      if (anuncios[item.id] && item.resumen) {
        anuncios[item.id].resumenIA = item.resumen.trim();
      }
    });
  } catch (err) {
    console.warn("⚠️ Aviso: La IA no pudo devolver el JSON, se omitirá el resumen:", err.message);
  }

  return anuncios;
}
