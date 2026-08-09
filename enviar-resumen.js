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

// Función robusta con formato JSON para asegurar que la IA devuelva los resúmenes limpios
async function enriquecerTitulosConIA(anuncios) {
  if (!anuncios || anuncios.length === 0 || !GEMINI_API_KEY) return anuncios;

  const listaParaIA = anuncios.map((a, index) => ({ id: index, texto: a.titulo }));

  const prompt = `
    Eres un experto en comunicación clara. Tu tarea es reescribir los títulos de los siguientes anuncios oficiales 
    para que sean un resumen muy sencillo, claro y directo, eliminando la jerga burocrática excesiva.
    
    Devuelve la respuesta EXCLUSIVAMENTE en formato de array JSON válido, sin markdown ni texto adicional, con esta estructura exacta para cada elemento:
    [
      {"id": 0, "resumen": "Resumen claro y directo de 1 o 2 líneas"},
      ...
    ]

    Anuncios a procesar:
    ${JSON.stringify(listaParaIA)}
  `;

  try {
    console.log("🤖 Generando resúmenes claros con Gemini...");
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
    });

    let textoRespuesta = response.text.trim();
    // Limpieza por si la IA devuelve bloques de código markdown tipo ```json ... ```
    textoRespuesta = textoRespuesta.replace(/```json/g, '').replace(/```/g, '').trim();

    const jsonRespuetas = JSON.parse(textoRespuesta);
    
    jsonRespuetas.forEach(item => {
      if (anuncios[item.id] && item.resumen) {
        anuncios[item.id].titulo = item.resumen.trim();
      }
    });
  } catch (err) {
    console.warn("⚠️ Aviso: La IA no pudo devolver el JSON limpio, se usarán los títulos originales:", err.message);
  }

  return anuncios;
}

async function iniciarProcesoGlobal() {
  console.log("🚀 Iniciando proceso unificado BOJA y BOE con resúmenes y estructura fija...");

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

  console.log(`📌 Encontrados ${anunciosPendientes.length} anuncios nuevos. Procesando...`);

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

    const nombreUsuario = usuario.email.split('@')[0];

    console.log(`📧 Enviando resumen personalizado a ${usuario.email} (${totalAlertas} alertas)...`);

    // Renderizado BOJA con soporte para "sin resultados"
    let htmlBojaContent = "";
    if (relevantesBoja.length > 0) {
      htmlBojaContent = relevantesBoja.map(r => `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #10b981; padding: 15px; margin-bottom: 15px; border-radius: 6px;">
          <span style="font-size: 11px; font-weight: bold; background: #ecfdf5; color: #047857; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">${r.categoria || r.sector}</span>
          <h4 style="font-size: 15px; color: #1e293b; margin: 10px 0 12px 0; line-height: 1.4;">${r.titulo}</h4>
          <a href="${r.url_pdf}" target="_blank" style="font-size: 12px; color: #047857; font-weight: bold; text-decoration: none;">📄 Ver PDF Oficial &rarr;</a>
        </div>
      `).join("");
    } else {
      htmlBojaContent = `<p style="font-size: 14px; color: #64748b; font-style: italic; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px dashed #cbd5e1;">No hay ningún anuncio que coincida con tus intereses en esta sección.</p>`;
    }

    // Renderizado BOE con soporte para "sin resultados"
    let htmlBoeContent = "";
    if (relevantesBoe.length > 0) {
      htmlBoeContent = relevantesBoe.map(r => `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #3b82f6; padding: 15px; margin-bottom: 15px; border-radius: 6px;">
          <span style="font-size: 11px; font-weight: bold; background: #eff6ff; color: #1d4ed8; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">${r.categoria || r.sector}</span>
          <h4 style="font-size: 15px; color: #1e293b; margin: 10px 0 12px 0; line-height: 1.4;">${r.titulo}</h4>
          <a href="${r.url_pdf}" target="_blank" style="font-size: 12px; color: #1d4ed8; font-weight: bold; text-decoration: none;">📄 Ver PDF Oficial &rarr;</a>
        </div>
      `).join("");
    } else {
      htmlBoeContent = `<p style="font-size: 14px; color: #64748b; font-style: italic; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px dashed #cbd5e1;">No hay ningún anuncio que coincida con tus intereses en esta sección.</p>`;
    }

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
