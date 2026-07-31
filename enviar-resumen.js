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

  // 1. Ejecutamos los capturadores para que recojan y guarden lo nuevo en Supabase con enviado: false
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

  // 2. Consultamos ÚNICAMENTE los anuncios que todavía NO han sido enviados (enviado = false)
  console.log("📥 Consultando anuncios pendientes de envío...");
  const anunciosPendientes = await supabaseRequest("anuncios_boja?enviado=eq.false&select=*");

  if (!anunciosPendientes || anunciosPendientes.length === 0) {
    console.log("📭 No hay nuevos anuncios pendientes de enviar en esta franja horaria.");
    return;
  }

  console.log(`📌 Encontrados ${anunciosPendientes.length} anuncios nuevos para notificar.`);

  // Separamos los pendientes según su origen
  const documentosBoja = anunciosPendientes.filter(d => d.origen === "BOJA" || !d.origen);
  const documentosBoe = anunciosPendientes.filter(d => d.origen === "BOE");

  // 3. Consultamos los usuarios activos en Supabase
  console.log("👥 Consultando usuarios suscritos...");
  const usuarios = await supabaseRequest("perfiles_usuarios?select=email,sectores_suscritos&estado_suscripcion=eq.activa");

  if (!usuarios || usuarios.length === 0) {
    console.log("⚠️ No hay usuarios activos.");
    return;
  }

  let idsAnotadosComoEnviados = [];

  // 4. Enviamos el correo unificado a cada usuario con sus alertas pendientes correspondientes
  for (const usuario of usuarios) {
    const relevantesBoja = documentosBoja.filter(doc => usuario.sectores_suscritos?.includes(doc.categoria || doc.sector));
    const relevantesBoe = documentosBoe.filter(doc => usuario.sectores_suscritos?.includes(doc.categoria || doc.sector));

    const totalAlertas = relevantesBoja.length + relevantesBoe.length;
    if (totalAlertas === 0) continue;

    console.log(`📧 Enviando correo unificado a ${usuario.email} (${totalAlertas} alertas)...`);

    // HTML Bloque BOJA (Verde)
    let htmlBoja = relevantesBoja.length > 0 ? relevantesBoja.map(r => `
      <li style="margin-bottom: 10px;">
        <strong>[${(r.categoria || r.sector).toUpperCase()}]</strong><br>
        <span style="font-size: 14px; color: #333;">${r.titulo}</span><br>
        <a href="${r.url_pdf}" target="_blank" style="color: #047857; font-weight: bold; text-decoration: underline;">Ver PDF del BOJA</a>
      </li>
    `).join("") : '<p style="color: #666; font-style: italic;">Sin novedades en tus sectores para el BOJA en este aviso.</p>';

    // HTML Bloque BOE (Azul)
    let htmlBoe = relevantesBoe.length > 0 ? relevantesBoe.map(r => `
      <li style="margin-bottom: 10px;">
        <strong>[${(r.categoria || r.sector).toUpperCase()}]</strong><br>
        <span style="font-size: 14px; color: #333;">${r.titulo}</span><br>
        <a href="${r.url_pdf}" target="_blank" style="color: #1d4ed8; font-weight: bold; text-decoration: underline;">Ver PDF del BOE</a>
      </li>
    `).join("") : '<p style="color: #666; font-style: italic;">Sin novedades en tus sectores para el BOE en este aviso.</p>';

    const htmlFinal = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e293b; text-align: center;">Resumen de Boletines Oficiales</h2>
        <p>Hola, tienes <strong>${totalAlertas} alertas nuevas</strong> desde la última revisión:</p>
        
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
      subject: `Tienes ${totalAlertas} nuevas alertas en tus boletines oficiales`,
      html: htmlFinal
    });

    // Recopilamos los IDs de los anuncios incluidos en los envíos de los usuarios
    [...relevantesBoja, ...relevantesBoe].forEach(doc => {
      if (doc.id && !idsAnotadosComoEnviados.includes(doc.id)) {
        idsAnotadosComoEnviados.push(doc.id);
      }
    });
  }

  // 5. Marcamos en Supabase los anuncios notificados como enviados (enviado = true) para que no se repitan
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

  console.log("✅ Proceso unificado completado con éxito.");
}

// Ejecución de la función principal
iniciarProcesoGlobal().catch(err => {
  console.error("❌ Error crítico en el proceso global:", err);
  process.exit(1);
});
