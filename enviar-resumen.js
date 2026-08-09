import { ejecutarBOJA } from './capturador.js';
import { ejecutarBOE } from './capturador-boe.js';
import { Resend } from 'resend';
import { GoogleGenAI } from '@google/genai';

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

// Función mejorada: La IA extrae Titular, A quién afecta y Plazo en formato estructurado
async function enriquecerTitulosConIA(anuncios) {
  if (!anuncios || anuncios.length === 0 || !GEMINI_API_KEY) return anuncios;

  const listaTextos = anuncios.map((a, index) => `${index + 1}. [${a.categoria || a.sector}] ${a.titulo}`).join("\n");

  const prompt = `
    Eres un analista experto en boletines oficiales (BOJA y BOE). 
    Para cada uno de los siguientes anuncios oficiales, extrae o deduce la información clave y devuélvela EXACTAMENTE con el siguiente formato estructurado por número:

    [NUMERO]
    TITULO: [Un titular breve, directo y ejecutivo de lo que trata la norma o anuncio]
    AFECTA: [A quién va dirigido o a qué colectivos, administraciones o sectores afecta exactamente. Si no se especifica, pon "General / No especificado"]
    PLAZO: [El plazo de presentación de solicitudes, recurso o entrada en vigor si se menciona; si no hay plazo explícito, pon "No especificado / Ver documento"]

    Lista de anuncios a procesar:
    ${listaTextos}
  `;

  try {
    console.log("🤖 Analizando y estructurando datos con Gemini (Capa Gratuita)...");
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
    });

    const textoRespuesta = response.text;
    
    // Parseamos la respuesta estructurada por bloques de números
    const bloques = textoRespuesta.split(/\[?(\d+)\]?\s*\n/);
    
    for (let i = 1; i < bloques.length; i += 2) {
      const index = parseInt(bloques[i]) - 1;
      const contenido = bloques[i + 1];

      if (anuncios[index] && contenido) {
        const matchTitulo = contenido.match(/TITULO:\s*(.*)/i);
        const matchAfecta = contenido.match(/AFECTA:\s*(.*)/i);
        const matchPlazo = contenido.match(/PLAZO:\s*(.*)/i);

        if (matchTitulo && matchTitulo[1]) anuncios[index].titulo = matchTitulo[1].trim();
        if (matchAfecta && matchAfecta[1]) anuncios[index].afectaIA = matchAfecta[1].trim();
        if (matchPlazo && matchPlazo[1]) anuncios[index].plazoIA = matchPlazo[1].trim();
      }
    }
  } catch (err) {
    console.warn("⚠️ Aviso: La IA no pudo estructurar el lote, se usarán los datos estándar:", err.message);
  }

  return anuncios;
}

async function iniciarProcesoGlobal() {
  console.log("🚀 Iniciando proceso unificado BOJA y BOE con IA estructurada...");

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

  console.log(`📌 Encontrados ${anunciosPendientes.length} anuncios nuevos. Analizando con IA...`);

  const anunciosProcesados = await enriquecerTitulosConIA(anunciosPendientes);

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

    console.log(`📧 Enviando correo estructurado a ${usuario.email} (${totalAlertas} alertas)...`);

    // Tarjeta con diseño ejecutivo avanzado (A quién afecta y Plazo)
    let htmlBoja = relevantesBoja.length > 0 ? relevantesBoja.map(r => `
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #10b981; padding: 15px; margin-bottom: 15px; border-radius: 6px;">
        <span style="font-size: 11px; font-weight: bold; background: #ecfdf5; color: #047857; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">${r.categoria || r.sector}</span>
        <h4 style="font-size: 15px; color: #1e293b; margin: 10px 0 8px 0; line-height: 1.4;">${r.titulo}</h4>
        
        <div style="font-size: 13px; color: #475569; margin-bottom: 6px;">
          <strong>👥 A quién afecta:</strong> ${r.afectaIA || 'General'}
        </div>
        <div style="font-size: 13px; color: #475569; margin-bottom: 12px;">
          <strong>⏳ Plazo:</strong> ${r.plazoIA || 'No especificado'}
        </div>

        <a href="${r.url_pdf}" target="_blank" style="font-size: 12px; color: #047857; font-weight: bold; text-decoration: none;">📄 Ver PDF Oficial &rarr;</a>
      </div>
    `).join("") : '';

    let htmlBoe = relevantesBoe.length > 0 ? relevantesBoe.map(r => `
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #3b82f6; padding: 15px; margin-bottom: 15px; border-radius: 6px;">
        <span style="font-size: 11px; font-weight: bold; background: #eff6ff; color: #1d4ed8; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">${r.categoria || r.sector}</span>
        <h4 style="font-size: 15px; color: #1e293b; margin: 10px 0 8px 0; line-height: 1.4;">${r.titulo}</h4>
        
        <div style="font-size: 13px; color: #475569; margin-bottom: 6px;">
          <strong>👥 A quién afecta:</strong> ${r.afectaIA || 'General'}
        </div>
        <div style="font-size: 13px; color: #475569; margin-bottom: 12px;">
          <strong>⏳ Plazo:</strong> ${r.plazoIA || 'No especificado'}
        </div>

        <a href="${r.url_pdf}" target="_blank" style="font-size: 12px; color: #1d4ed8; font-weight: bold; text-decoration: none;">📄 Ver PDF Oficial &rarr;</a>
      </div>
    `).join("") : '';

    const htmlFinal = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; padding: 30px 20px; color: #334155;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0;">
          
          <div style="background: #0f172a; padding: 20px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0; font-size: 20px;">Resumen Inteligente de Boletines</h2>
            <p style="color: #94a3b8; font-size: 13px; margin: 5px 0 0 0;">Análisis ejecutivo generado por IA</p>
          </div>

          <div style="padding: 25px;">
            <p style="font-size: 15px; color: #334155; margin-top: 0;">Hola, aquí tienes el desglose estructurado de las <strong>${totalAlertas} novedades</strong> de hoy:</p>
            
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
        subject: `Resumen IA: ${totalAlertas} nuevas alertas analizadas`,
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

  console.log("✅ Proceso completado con éxito.");
}

iniciarProcesoGlobal().catch(err => {
  console.error("❌ Error crítico:", err);
  process.exit(1);
});
