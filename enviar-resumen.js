import { ejecutarBOJA } from './capturador.js';
import { ejecutarBOE } from './capturador-boe.js';
import { Resend } from 'resend';
import { GoogleGenAI } from '@google/genai';

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const resend = new Resend(RESEND_API_KEY);
// Inicializamos el SDK oficial de Gemini
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

// Función para resumir títulos de forma inteligente y limpia con Gemini (A coste 0€)
async function enriquecerTitulosConIA(anuncios) {
  if (!anuncios || anuncios.length === 0 || !GEMINI_API_KEY) return anuncios;

  // Preparamos una lista limpia de títulos para enviar en un solo lote
  const listaTextos = anuncios.map((a, index) => `${index + 1}. [${a.categoria || a.sector}] ${a.titulo}`).join("\n");

  const prompt = `
    Eres un asistente editorial experto en boletines oficiales. 
    A continuación tienes una lista de títulos de anuncios oficiales. 
    Tu tarea es reescribir cada título manteniendo estrictamente su número de orden, haciéndolo directo, ejecutivo, comercial y fácil de leer para un profesional, eliminando la burocracia excesiva pero sin inventar datos ni cambiar su significado legal básico. Devuelve únicamente la lista numerada con los títulos mejorados.

    Lista de anuncios:
    ${listaTextos}
  `;

  try {
    console.log("🤖 Solicitando resumen y mejora de títulos a Gemini (Capa Gratuita)...");
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
    });

    const textoRespuesta = response.text;
    const lineas = textoRespuesta.split("\n").filter(l => l.trim().length > 0);

    // Mapeamos de vuelta las respuestas mejoradas a los anuncios originales
    lineas.forEach(linea => {
      const match = linea.match(/^(\d+)\.\s*(?:\[.*?\])?\s*(.*)$/);
      if (match) {
        const index = parseInt(match[1]) - 1;
        const nuevoTitulo = match[2].trim();
        if (anuncios[index] && nuevoTitulo) {
          anuncios[index].titulo = nuevoTitulo;
        }
      }
    });
  } catch (err) {
    console.warn("⚠️ Aviso: La IA no pudo procesar el lote, se usarán los títulos originales:", err.message);
  }

  return anuncios;
}

async function iniciarProcesoGlobal() {
  console.log("🚀 Iniciando proceso unificado BOJA y BOE con IA...");

  try {
    await ejecutarBOJA();
  } catch (err) {
    console.error("❌ Error en BOJA:", err.message);
  }

  try {
    await ejecutarBOE();
  } catch (err) {
    console.error("❌ Error en BOE:", err.message);
  }

  console.log("📥 Consultando anuncios pendientes de envío...");
  const anunciosPendientes = await supabaseRequest("anuncios_boja?enviado=eq.false&select=*");

  if (!anunciosPendientes || anunciosPendientes.length === 0) {
    console.log("📭 No hay nuevos anuncios pendientes de enviar en esta franja horaria.");
    return;
  }

  console.log(`📌 Encontrados ${anunciosPendientes.length} anuncios nuevos. Procesando con IA...`);

  // Pasamos los anuncios pendientes por el filtro de Gemini en lote único
  const anunciosProcesados = await enriquecerTitulosConIA(anunciosPendientes);

  // Separamos los pendientes según su origen ya mejorados
  const documentosBoja = anunciosProcesados.filter(d => d.origen === "BOJA" || !d.origen);
  const documentosBoe = anunciosProcesados.filter(d => d.origen === "BOE");

  console.log("👥 Consultando usuarios suscritos...");
  const usuarios = await supabaseRequest("perfiles_usuarios?select=email,sectores_suscritos&estado_suscripcion=eq.activa");

  if (!usuarios || usuarios.length === 0) {
    console.log("⚠️ No hay usuarios activos.");
    return;
  }

  let idsAnotadosComoEnviados = [];

  for (const usuario of usuarios) {
    const sectoresUsuario = usuario.sectores_suscritos || [];
    
    const relevantesBoja = documentosBoja.filter(doc => {
      const cat = doc.categoria || doc.sector;
      return sectoresUsuario.some(s => s.toLowerCase() === cat.toLowerCase());
    });

    const relevantesBoe = documentosBoe.filter(doc => {
      const cat = doc.categoria || doc.sector;
      return sectoresUsuario.some(s => s.toLowerCase() === cat.toLowerCase());
    });

    const totalAlertas = relevantesBoja.length + relevantesBoe.length;
    if (totalAlertas === 0) continue;

    console.log(`📧 Enviando correo unificado a ${usuario.email} (${totalAlertas} alertas enriquecidas)...`);

    let htmlBoja = relevantesBoja.length > 0 ? relevantesBoja.map(r => `
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #10b981; padding: 12px 15px; margin-bottom: 12px; border-radius: 6px;">
        <span style="font-size: 11px; font-weight: bold; background: #ecfdf5; color: #047857; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">${r.categoria || r.sector}</span>
        <p style="font-size: 14px; color: #1e293b; margin: 8px 0 10px 0; line-height: 1.4;">${r.titulo}</p>
        <a href="${r.url_pdf}" target="_blank" style="font-size: 12px; color: #047857; font-weight: bold; text-decoration: none;">Ver documento oficial &rarr;</a>
      </div>
    `).join("") : '';

    let htmlBoe = relevantesBoe.length > 0 ? relevantesBoe.map(r => `
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #3b82f6; padding: 12px 15px; margin-bottom: 12px; border-radius: 6px;">
        <span style="font-size: 11px; font-weight: bold; background: #eff6ff; color: #1d4ed8; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">${r.categoria || r.sector}</span>
        <p style="font-size: 14px; color: #1e293b; margin: 8px 0 10px 0; line-height: 1.4;">${r.titulo}</p>
        <a href="${r.url_pdf}" target="_blank" style="font-size: 12px; color: #1d4ed8; font-weight: bold; text-decoration: none;">Ver documento oficial &rarr;</a>
      </div>
    `).join("") : '';

    const htmlFinal = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; padding: 30px 20px; color: #334155;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0;">
          
          <div style="background: #0f172a; padding: 20px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0; font-size: 20px;">Resumen Diario Oficial</h2>
            <p style="color: #94a3b8; font-size: 13px; margin: 5px 0 0 0;">Tus alertas personalizadas y optimizadas por IA</p>
          </div>

          <div style="padding: 25px;">
            <p style="font-size: 15px; color: #334155; margin-top: 0;">Hola, hemos detectado <strong>${totalAlertas} novedades</strong> resumidas para ti:</p>
            
            ${relevantesBoja.length > 0 ? `
              <h3 style="color: #047857; font-size: 16px; border-bottom: 2px solid #10b981; padding-bottom: 5px; margin-top: 25px;">🟢 Junta de Andalucía (BOJA)</h3>
              ${htmlBoja}
            ` : ''}

            ${relevantesBoe.length > 0 ? `
              <h3 style="color: #1d4ed8; font-size: 16px; border-bottom: 2px solid #3b82f6; padding-bottom: 5px; margin-top: 25px;">🔵 Estado (BOE)</h3>
              ${htmlBoe}
            ` : ''}
          </div>

          <div style="background: #f1f5f9; padding: 15px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="font-size: 12px; color: #64748b; margin: 0;">Mensaje automático generado por <strong>BoletínHoy</strong>.</p>
          </div>

        </div>
      </div>
    `;

    try {
      await resend.emails.send({
        from: 'BoletínHoy <alertas@boletinhoy.es>',
        to: [usuario.email],
        subject: `Tienes ${totalAlertas} nuevas alertas optimizadas en tus boletines`,
        html: htmlFinal
      });

      [...relevantesBoja, ...relevantesBoe].forEach(doc => {
        if (doc.id && !idsAnotadosComoEnviados.includes(doc.id)) {
          idsAnotadosComoEnviados.push(doc.id);
        }
      });
    } catch (emailErr) {
      console.error(`❌ Error al enviar email con Resend a ${usuario.email}:`, emailErr.message);
    }
  }

  if (idsAnotadosComoEnviados.length > 0) {
    console.log("🔄 Actualizando estado de anuncios a 'enviado: true' en Supabase...");
    for (const idAnuncio of idsAnotadosComoEnviados) {
      try {
        await supabaseRequest(`anuncios_boja?id=eq.${idAnuncio}`, {
          method: "PATCH",
          body: JSON.stringify({ enviado: true })
        });
      } catch (err) {
        console.log(`⚠️ No se pudo actualizar el anuncio ${idAnuncio}: ${err.message}`);
      }
    }
  }

  console.log("✅ Proceso unificado con IA completado con éxito.");
}

iniciarProcesoGlobal().catch(err => {
  console.error("❌ Error crítico en el proceso global con IA:", err);
  process.exit(1);
});
