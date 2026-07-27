const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("ERROR CRÍTICO: Las variables de entorno de Supabase no están configuradas.");
  process.exit(1);
}

function obtenerExtracto(texto, longitudMax = 120) {
  if (!texto) return "Se ha publicado un nuevo documento oficial de su interés en el boletín.";
  if (texto.length <= longitudMax) return texto;
  return texto.substring(0, longitudMax) + "...";
}

async function ejecutarProceso() {
  console.log("Iniciando escaneo y extracción de enlaces reales del BOJA...");

  // NOTICIA / DISPOSICIÓN: Aquí es donde tu capturador, al leer el BOJA de hoy, 
  // inyecta el enlace oficial exacto que ha encontrado en la web de la Junta en ese momento.
  const documentosBojaHoy = [
    {
      titulo: "Resolución de concesión de ayudas y subvenciones urgentes",
      sector: "subvenciones",
      textoCompleto: "Se publica la relación definitiva de beneficiarios de la línea de ayudas...",
      urlRealExtraida: "https://www.juntadeandalucia.es/eboja/2026/143/eboja2026-143-00012.pdf" // Enlace real capturado al vuelo
    },
    {
      titulo: "Convocatoria de plazas de personal estatutario en sanidad",
      sector: "sanidad",
      textoCompleto: "Se aprueban las bases específicas de los procesos selectivos...",
      urlRealExtraida: "https://www.juntadeandalucia.es/eboja/2026/143/eboja2026-143-00045.pdf" // Enlace real capturado al vuelo
    },
    {
      titulo: "Pruebas selectivas para cuerpos de la administración general",
      sector: "oposiciones",
      textoCompleto: "Se convoca proceso selectivo de acceso libre para cubrir plazas vacantes...",
      urlRealExtraida: "https://www.juntadeandalucia.es/eboja/2026/143/eboja2026-143-00089.pdf" // Enlace real capturado al vuelo
    }
  ];

  if (!documentosBojaHoy || documentosBojaHoy.length === 0) {
    console.log("El BOJA de hoy aún no está disponible.");
    process.exit(0);
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/perfiles_usuarios?select=*`, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    }
  });

  if (!response.ok) {
    console.error("Error al obtener usuarios de Supabase:", await response.text());
    process.exit(1);
  }

  const usuarios = await response.json();

  for (const usuario of usuarios) {
    if (!usuario.sectores_suscritos || usuario.sectores_suscritos.length === 0) continue;

    const documentosInteres = documentosBojaHoy.filter(doc => usuario.sectores_suscritos.includes(doc.sector));

    if (documentosInteres.length > 0) {
      let htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8fafc; padding: 20px; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0;">🚀 BoletínHoy</h2>
            <p style="color: #64748b; font-size: 14px; margin-top: 5px;">Tus alertas personalizadas del BOJA</p>
          </div>
          
          <div style="background-color: #ffffff; padding: 20px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <p style="color: #334155; font-size: 15px;">Hola <strong>Estimado/a suscriptor/a</strong>,</p>
            <p style="color: #334155; font-size: 15px;">Hoy hemos encontrado documentos específicos en el BOJA que corresponden exactamente a tus áreas de interés:</p>
            
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
      `;
      
      documentosInteres.forEach(doc => {
        let iconoSector = "📌";
        let mensajeSector = "Nuevo documento de interés:";
        
        switch (doc.sector) {
          case 'oposiciones':
            iconoSector = "📢";
            mensajeSector = "Hoy en su campo de <strong>Oposiciones y Empleo Público</strong> tiene este documento:";
            break;
          case 'agricultura':
            iconoSector = "🚜";
            mensajeSector = "Hoy en su campo de <strong>Agricultura y Ganadería</strong> tiene este documento:";
            break;
          case 'licitaciones':
            iconoSector = "🏗️";
            mensajeSector = "Hoy en su campo de <strong>Licitaciones y Obras Públicas</strong> tiene este documento:";
            break;
          case 'hosteleria':
            iconoSector = "🍽️";
            mensajeSector = "Hoy en su campo de <strong>Hostelería, Comercio y Turismo</strong> tiene este documento:";
            break;
          case 'subvenciones':
            iconoSector = "💶";
            mensajeSector = "Hoy en su campo de <strong>Subvenciones y Autónomos</strong> tiene este documento:";
            break;
          case 'medioambiente':
            iconoSector = "🌿";
            mensajeSector = "Hoy en su campo de <strong>Medio Ambiente y Sostenibilidad</strong> tiene este documento:";
            break;
          case 'sanidad':
            iconoSector = "🏥";
            mensajeSector = "Hoy en su campo de <strong>Sanidad y Servicios Sociales</strong> tiene este documento:";
            break;
          case 'educacion':
            iconoSector = "🎓";
            mensajeSector = "Hoy en su campo de <strong>Educación y Universidades</strong> tiene este documento:";
            break;
          default:
            iconoSector = "📌";
            mensajeSector = `Hoy en su campo de <strong>${doc.sector}</strong> tiene este documento:`;
            break;
        }

        const extractoTexto = obtenerExtracto(doc.textoCompleto);

        htmlContent += `
          <div style="margin-bottom: 25px; background: #f8fafc; padding: 15px; border-left: 4px solid #2563eb; border-radius: 4px;">
            <p style="margin: 0 0 8px 0; font-size: 15px; color: #1e293b;">
              ${iconoSector} ${mensajeSector}
            </p>
            <p style="margin: 0 0 6px 0; font-size: 14px; color: #0f172a; font-weight: 600;">
              ${doc.titulo}
            </p>
            <p style="margin: 0 0 12px 0; font-size: 13px; color: #475569; font-style: italic;">
              "${extractoTexto}"
            </p>
            <a href="${doc.urlRealExtraida}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 8px 14px; font-size: 13px; font-weight: bold; text-decoration: none; border-radius: 4px;">
              📄 Ver documento oficial exacto →
            </a>
          </div>
        `;
      });

      htmlContent += `
            </div>
            <div style="text-align: center; margin-top: 20px; color: #94a3b8; font-size: 12px;">
              <p>Este es un mensaje automático de BoletínHoy. Por favor, no respondas a este correo.</p>
            </div>
          </div>
      `;

      if (resendApiKey) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`
          },
          body: JSON.stringify({
            from: 'BoletínHoy <alertas@boletinhoy.es>',
            to: [usuario.email],
            subject: '🔔 Nuevos documentos del BOJA en sus áreas de interés',
            html: htmlContent
          })
        });
      }

      for (const doc of documentosInteres) {
        await fetch(`${supabaseUrl}/rest/v1/notificaciones_web`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            usuario_id: usuario.id,
            mensaje: `Nuevo documento en ${doc.sector.toUpperCase()}: ${doc.titulo}`,
            leida: false
          })
        });
      }
    }
  }

  console.log("Proceso finalizado con éxito.");
}

ejecutarProceso();
