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

// Función con IA para enriquecer los títulos de forma segura
async function enriquecerTitulosConIA(anuncios) {
  if (!anuncios || anuncios.length === 0 || !GEMINI_API_KEY) return anuncios;

  console.log(`🤖 Generando resúmenes inteligentes por lotes seguros para ${anuncios.length} anuncios...`);
  const tamanoLote = 5; // Reducimos el lote a 5 para no saturar

  for (let i = 0; i < anuncios.length; i += tamanoLote) {
    const lote = anuncios.slice(i, i + tamanoLote);
    const listaParaIA = lote.map((a, index) => ({ id: index, texto: a.titulo }));

    const prompt = `
      Eres un asesor experto. Explica brevemente de qué trata este anuncio oficial para que un profesional entienda su propósito real:
      ${JSON.stringify(listaParaIA)}
      
      Devuelve la respuesta EXCLUSIVAMENTE en formato de array JSON válido, sin bloques de código, con esta estructura:
      [{"id": 0, "resumen": "Explicación clara del propósito"}]
    `;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash', // Volvemos al modelo estándar estable 1.5-flash
        contents: prompt,
      });

      let textoRespuesta = response.text.trim();
      if (textoRespuesta.startsWith("```json")) textoRespuesta = textoRespuesta.replace("```json", "");
      if (textoRespuesta.startsWith("```")) textoRespuesta = textoRespuesta.replace("```", "");
      if (textoRespuesta.endsWith("```")) textoRespuesta = textoRespuesta.slice(0, -3);
      textoRespuesta = textoRespuesta.trim();

      const jsonRespuetas = JSON.parse(textoRespuesta);
      
      jsonRespuetas.forEach(item => {
        if (lote[item.id] && item.resumen) {
          lote[item.id].resumenIA = item.resumen.trim();
        }
      });
    } catch (err) {
      console.warn(`⚠️ Aviso en lote ${i}:`, err.message);
      lote.forEach(a => {
        a.resumenIA = a.titulo;
      });
    }

    // Pausa de 15 segundos obligatoria entre lotes para respetar el límite gratuito (Rate Limit)
    if (i + tamanoLote < anuncios.length) {
      console.log("⏳ Pausa de 15s para evitar el límite de la API...");
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  }

  return anuncios;
}
async function iniciarProcesoGlobal() {
  console.log("🚀 Iniciando proceso unificado BOJA y BOE...");

  let documentosBoja = [];
  let documentosBoe = [];

  try {
    documentosBoja = await ejecutarBOJA() || [];
  } catch (err) {
    console.error("❌ Error en BOJA:", err.message);
  }

  try {
    documentosBoe = await ejecutarBOE() || [];
  } catch (err) {
    console.error("❌ Error en BOE:", err.message);
  }

  const totalDetectados = documentosBoja.length + documentosBoe.length;
  console.log(`📌 Detectados ${totalDetectados} anuncios en total (${documentosBoja.length} BOJA, ${documentosBoe.length} BOE).`);

  if (totalDetectados === 0) {
    console.log("📭 No hay nuevos anuncios hoy.");
    return;
  }

  // Enriquecemos ambos bloques con la IA de forma unificada
  console.log("🧠 Procesando resúmenes con IA...");
  documentosBoja = await enriquecerTitulosConIA(documentosBoja);
  documentosBoe = await enriquecerTitulosConIA(documentosBoe);

  console.log("👥 Consultando usuarios suscritos...");
  const usuarios = await supabaseRequest("perfiles_usuarios?select=email,sectores_suscritos&estado_suscripcion=eq.activa");

  if (!usuarios || usuarios.length === 0) {
    console.log("⚠️ No hay usuarios activos.");
    return;
  }

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

    const nombreUsuario = usuario.email.split('@')[0];
    console.log(`📧 Enviando resumen personalizado a ${usuario.email} (${totalAlertas} alertas)...`);

    let htmlBojaContent = relevantesBoja.length > 0 ? relevantesBoja.map(r => `
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #10b981; padding: 15px; margin-bottom: 15px; border-radius: 6px;">
        <span style="font-size: 11px; font-weight: bold; background: #ecfdf5; color: #047857; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">${r.categoria || r.sector}</span>
        <h4 style="font-size: 15px; color: #1e293b; margin: 10px 0 10px 0; line-height: 1.4;">${r.titulo}</h4>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 12px; margin-bottom: 12px; border-radius: 4px;">
          <p style="font-size: 13px; color: #334155; margin: 0; line-height: 1.4;"><strong>¿Por qué te interesa?:</strong> ${r.resumenIA || r.titulo}</p>
        </div>
        <a href="${r.url_pdf}" target="_blank" style="font-size: 12px; color: #047857; font-weight: bold; text-decoration: none;">📄 Ver PDF Oficial &rarr;</a>
      </div>
    `).join("") : `<p style="font-size: 14px; color: #64748b; font-style: italic; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px dashed #cbd5e1;">No hay ningún anuncio en esta sección.</p>`;

    let htmlBoeContent = relevantesBoe.length > 0 ? relevantesBoe.map(r => `
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #3b82f6; padding: 15px; margin-bottom: 15px; border-radius: 6px;">
        <span style="font-size: 11px; font-weight: bold; background: #eff6ff; color: #1d4ed8; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">${r.categoria || r.sector}</span>
        <h4 style="font-size: 15px; color: #1e293b; margin: 10px 0 10px 0; line-height: 1.4;">${r.titulo}</h4>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 12px; margin-bottom: 12px; border-radius: 4px;">
          <p style="font-size: 13px; color: #334155; margin: 0; line-height: 1.4;"><strong>¿Por qué te interesa?:</strong> ${r.resumenIA || r.titulo}</p>
        </div>
        <a href="${r.url_pdf}" target="_blank" style="font-size: 12px; color: #1d4ed8; font-weight: bold; text-decoration: none;">📄 Ver PDF Oficial &rarr;</a>
      </div>
    `).join("") : `<p style="font-size: 14px; color: #64748b; font-style: italic; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px dashed #cbd5e1;">No hay ningún anuncio en esta sección.</p>`;

    const htmlFinal = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; padding: 30px 20px; color: #334155;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0;">
          <div style="background: #0f172a; padding: 20px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0; font-size: 20px;">Resumen Diario Oficial</h2>
            <p style="color: #94a3b8; font-size: 13px; margin: 5px 0 0 0;">Tus alertas personalizadas</p>
          </div>
          <div style="padding: 25px;">
            <p style="font-size: 16px; color: #334155; margin-top: 0;">Hola <strong>${nombreUsuario}</strong>,</p>
            <p style="font-size: 15px; color: #334155;">Aquí tienes el desglose de las <strong>${totalAlertas} novedades</strong> de hoy:</p>
            
            <h3 style="color: #047857; font-size: 16px; border-bottom: 2px solid #10b981; padding-bottom: 5px; margin-top: 25px;">🟢 Junta de Andalucía (BOJA)</h3>
            ${htmlBojaContent}

            <h3 style="color: #1d4ed8; font-size: 16px; border-bottom: 2px solid #3b82f6; padding-bottom: 5px; margin-top: 25px;">🔵 Estado (BOE)</h3>
            ${htmlBoeContent}
          </div>
          <div style="background: #f1f5f9; padding: 15px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="font-size: 12px; color: #64748b; margin: 0;">BoletínHoy | Tu resumen diario.</p>
          </div>
        </div>
      </div>
    `;

    try {
      await resend.emails.send({
        from: 'BoletínHoy <alertas@boletinhoy.es>',
        to: [usuario.email],
        subject: `Resumen Personalizado: ${totalAlertas} nuevas alertas`,
        html: htmlFinal
      });
      console.log(`✅ Correo enviado con éxito a ${usuario.email}`);
    } catch (emailErr) {
      console.error(`❌ Error al enviar email con Resend a ${usuario.email}:`, emailErr.message);
    }
  }

  console.log("✅ Proceso completado con éxito.");
}

iniciarProcesoGlobal().catch(err => {
  console.error("❌ Error crítico:", err);
  process.exit(1);
});
