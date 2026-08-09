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

    console.log(`📧 Enviando correo unificado a ${usuario.email} (${totalAlertas} alertas)...`);

    // HTML Bloque BOJA (Estilo Tarjeta Ejecutiva Verde)
    let htmlBoja = relevantesBoja.length > 0 ? relevantesBoja.map(r => `
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #10b981; padding: 12px 15px; margin-bottom: 12px; border-radius: 6px;">
        <span style="font-size: 11px; font-weight: bold; background: #ecfdf5; color: #047857; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">${r.categoria || r.sector}</span>
        <p style="font-size: 14px; color: #1e293b; margin: 8px 0 10px 0; line-height: 1.4;">${r.titulo}</p>
        <a href="${r.url_pdf}" target="_blank" style="font-size: 12px; color: #047857; font-weight: bold; text-decoration: none;">Ver documento oficial &rarr;</a>
      </div>
    `).join("") : '';

    // HTML Bloque BOE (Estilo Tarjeta Ejecutiva Azul)
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
          
          <!-- Cabecera -->
          <div style="background: #0f172a; padding: 20px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0; font-size: 20px;">Resumen Diario Oficial</h2>
            <p style="color: #94a3b8; font-size: 13px; margin: 5px 0 0 0;">Tus alertas personalizadas de hoy</p>
          </div>

          <div style="padding: 25px;">
            <p style="font-size: 15px; color: #334155; margin-top: 0;">Hola, hemos detectado <strong>${totalAlertas} novedades</strong> en tus sectores de interés:</p>
            
            ${relevantesBoja.length > 0 ? `
              <h3 style="color: #047857; font-size: 16px; border-bottom: 2px solid #10b981; padding-bottom: 5px; margin-top: 25px;">🟢 Junta de Andalucía (BOJA)</h3>
              ${htmlBoja}
            ` : ''}

            ${relevantesBoe.length > 0 ? `
              <h3 style="color: #1d4ed8; font-size: 16px; border-bottom: 2px solid #3b82f6; padding-bottom: 5px; margin-top: 25px;">🔵 Estado (BOE)</h3>
              ${htmlBoe}
            ` : ''}
          </div>

          <!-- Pie -->
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
        subject: `Tienes ${totalAlertas} nuevas alertas en tus boletines oficiales`,
        html: htmlFinal
      });

      // Recopilamos los IDs de los anuncios incluidos en los envíos de los usuarios
      [...relevantesBoja, ...relevantesBoe].forEach(doc => {
        if (doc.id && !idsAnotadosComoEnviados.includes(doc.id)) {
          idsAnotadosComoEnviados.push(doc.id);
        }
      });
    } catch (emailErr) {
      console.error(`❌ Error al enviar email con Resend a ${usuario.email}:`, emailErr.message);
    }
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
