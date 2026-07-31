import { ejecutarBOJA } from './capturador.js';
import { ejecutarBOE } from './capturador-boe.js';
import { Resend } from 'resend';

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const resend = new Resend(RESEND_API_KEY);

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

async function iniciarProcesoGlobal() {
  console.log("🚀 Iniciando proceso unificado BOJA y BOE...");

  // 1. Ejecutamos ambos capturadores y obtenemos sus arrays de noticias
  let documentosBoja = [];
  let documentosBoe = [];

  try {
    documentosBoja = await ejecutarBOJA();
  } catch (err) {
    console.error("❌ Error en BOJA:", err.message);
  }

  try {
    documentosBoe = await ejecutarBOE();
  } catch (err) {
    console.error("❌ Error en BOE:", err.message);
  }

  // 2. Consultamos los usuarios activos en Supabase
  console.log("👥 Consultando usuarios suscritos...");
  const usuarios = await supabaseRequest("perfiles_usuarios?select=email,sectores_suscritos&estado_suscripcion=eq.activa");

  if (!usuarios || usuarios.length === 0) {
    console.log("⚠️ No hay usuarios activos.");
    return;
  }

  // 3. Enviamos un correo unificado a cada usuario según sus sectores
  for (const usuario of usuarios) {
    const relevantesBoja = (documentosBoja || []).filter(doc => usuario.sectores_suscritos?.includes(doc.sector));
    const relevantesBoe = (documentosBoe || []).filter(doc => usuario.sectores_suscritos?.includes(doc.sector));

    const totalAlertas = relevantesBoja.length + relevantesBoe.length;
    if (totalAlertas === 0) continue;

    console.log(`📧 Enviando correo unificado a ${usuario.email} (${totalAlertas} alertas)...`);

    // HTML Bloque BOJA (Verde)
    let htmlBoja = relevantesBoja.length > 0 ? relevantesBoja.map(r => `
      <li style="margin-bottom: 10px;">
        <strong>[${r.sector.toUpperCase()}]</strong><br>
        <span style="font-size: 14px; color: #333;">${r.titulo}</span><br>
        <a href="${r.url_pdf}" target="_blank" style="color: #047857; font-weight: bold; text-decoration: underline;">Ver PDF del BOJA</a>
      </li>
    `).join("") : '<p style="color: #666; font-style: italic;">Sin novedades en tus sectores para el BOJA hoy.</p>';

    // HTML Bloque BOE (Azul)
    let htmlBoe = relevantesBoe.length > 0 ? relevantesBoe.map(r => `
      <li style="margin-bottom: 10px;">
        <strong>[${r.sector.toUpperCase()}]</strong><br>
        <span style="font-size: 14px; color: #333;">${r.titulo}</span><br>
        <a href="${r.url_pdf}" target="_blank" style="color: #1d4ed8; font-weight: bold; text-decoration: underline;">Ver PDF del BOE</a>
      </li>
    `).join("") : '<p style="color: #666; font-style: italic;">Sin novedades en tus sectores para el BOE hoy.</p>';

    const htmlFinal = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e293b; text-align: center;">Resumen Diario Oficial</h2>
        <p>Hola, tienes <strong>${totalAlertas} alertas nuevas</strong> en los boletines oficiales de hoy:</p>
        
        <!-- BLOQUE BOJA (VERDE) -->
        <div style="border-left: 4px solid #10b981; background-color: #f0fdf4; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
          <h3 style="color: #047857; margin-top: 0;">🟢 Boletín Oficial de la Junta de Andalucía (BOJA)</h3>
          <ul style="line-height: 1.5; padding-left: 15px;">${htmlBoja}</ul>
        </div>

        <!-- BLOQUE BOE (AZUL) -->
        <div style="border-left: 4px solid #3b82f6; background-color: #eff6ff; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
          <h3 style="color: #1d4ed8; margin-top: 0;">🔵 Boletín Oficial del Estado (BOE)</h3>
          <ul style="line-height: 1.5; padding-left: 15px;">${htmlBoe}</ul>
        </div>

        <p style="font-size: 12px; color: #888; text-align: center; margin-top: 20px;">Mensaje automático de BoletínHoy.</p>
      </div>
    `;

    await resend.emails.send({
      from: 'BoletínHoy <alertas@boletinhoy.es>',
      to: [usuario.email],
      subject: `Tienes ${totalAlertas} alertas nuevas en tu BOE y BOJA`,
      html: htmlFinal
    });
  }

  console.log("✅ Proceso unificado completado con éxito.");
}

// Ejecución de la función principal
iniciarProcesoGlobal().catch(err => {
  console.error("❌ Error crítico en el proceso global:", err);
  process.exit(1);
});
