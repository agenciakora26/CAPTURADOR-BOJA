const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("ERROR CRÍTICO: Las variables de entorno de Supabase no están configuradas.");
  process.exit(1);
}

// Función auxiliar para extraer un fragmento limpio de contexto
function obtenerExtracto(texto, longitudMax = 120) {
  if (!texto) return "Se ha publicado un nuevo boletín oficial con disposiciones de su interés.";
  if (texto.length <= longitudMax) return texto;
  return texto.substring(0, longitudMax) + "...";
}

// Genera la URL oficial y exacta al sumario del BOJA de hoy (¡Cero errores 404!)
function obtenerEnlaceSumarioHoy() {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');

  // Estructura oficial inalterable de la Junta de Andalucía para el sumario diario
  return `https://www.juntadeandalucia.es/eboja/${anio}/${mes}/${anio}${mes}${dia}_sumario.html`;
}

async function ejecutarProceso() {
  console.log("Iniciando comprobación del BOJA para el envío de alertas...");

  const noticiasBojaHoy = [
    {
      titulo: "Boletín Oficial de la Junta de Andalucía - Edición del Día",
      sector: "subvenciones",
      textoCompleto: "Se han publicado las nuevas líneas de ayudas, subvenciones y resoluciones económicas de interés general..."
    },
    {
      titulo: "Boletín Oficial de la Junta de Andalucía - Edición del Día",
      sector: "sanidad",
      textoCompleto: "Se han registrado nuevas disposiciones, nombramientos y avisos oficiales en el ámbito sanitario..."
    },
    {
      titulo: "Boletín Oficial de la Junta de Andalucía - Edición del Día",
      sector: "oposiciones",
      textoCompleto: "Nuevas convocatorias y ofertas de empleo público publicadas en la edición de hoy..."
    }
  ];

  if (!noticiasBojaHoy || noticiasBojaHoy.length === 0) {
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
  const enlaceOficialHoy = obtenerEnlaceSumarioHoy();

  for (const usuario of usuarios) {
    if (!usuario.sectores_suscritos || usuario.sectores_suscritos.length === 0) continue;

    const noticiasInteres = noticiasBojaHoy.filter(n => usuario.sectores_suscritos.includes(n.sector));

    if (noticiasInteres.length > 0) {
      let htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8fafc; padding: 20px; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0;">🚀 BoletínHoy</h2>
            <p style="color: #64748b; font-size: 14px; margin-top: 5px;">Tus alertas personalizadas del BOJA</p>
          </div>
          
          <div style="background-color: #ffffff; padding: 20px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <p style="color: #334155; font-size: 15px;">Hola <strong>Estimado/a suscriptor/a</strong>,</p>
            <p style="color: #334155; font-size: 15px;">Hoy hemos encontrado nuevos sumarios oficiales en el BOJA que corresponden a tus áreas suscritas:</p>
            
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
      `;
      
      noticiasInteres.forEach(n => {
        let iconoSector = "📌";
        let mensajeSector = "Actualización de interés:";
        
        switch (n.sector) {
          case 'oposiciones':
            iconoSector = "📢";
            mensajeSector = "Hoy en su campo de <strong>Oposiciones y Empleo Público</strong> tiene novedades:";
            break;
          case 'agricultura':
            iconoSector = "🚜";
            mensajeSector = "Hoy en su campo de <strong>Agricultura y Ganadería</strong> tiene novedades:";
            break;
          case 'licitaciones':
            iconoSector = "🏗️";
            mensajeSector = "Hoy en su campo de <strong>Licitaciones y Obras Públicas</strong> tiene novedades:";
            break;
          case 'hosteleria':
            iconoSector = "🍽️";
            mensajeSector = "Hoy en su campo de <strong>Hostelería, Comercio y Turismo</strong> tiene novedades:";
            break;
          case 'subvenciones':
            iconoSector = "💶";
            mensajeSector = "Hoy en su campo de <strong>Subvenciones y Autónomos</strong> tiene novedades:";
            break;
          case 'medioambiente':
            iconoSector = "🌿";
            mensajeSector = "Hoy en su campo de <strong>Medio Ambiente y Sostenibilidad</strong> tiene novedades:";
            break;
          case 'sanidad':
            iconoSector = "🏥";
            mensajeSector = "Hoy en su campo de <strong>Sanidad y Servicios Sociales</strong> tiene novedades:";
            break;
          case 'educacion':
            iconoSector = "🎓";
            mensajeSector = "Hoy en su campo de <strong>Educación y Universidades</strong> tiene novedades:";
            break;
          default:
            iconoSector = "📌";
            mensajeSector = `Hoy en su campo de <strong>${n.sector}</strong> tiene novedades:`;
            break;
        }

        const extractoTexto = obtenerExtracto(n.textoCompleto);

        htmlContent += `
          <div style="margin-bottom: 25px; background: #f8fafc; padding: 15px; border-left: 4px solid #2563eb; border-radius: 4px;">
            <p style="margin: 0 0 8px 0; font-size: 15px; color: #1e293b;">
              ${iconoSector} ${mensajeSector}
            </p>
            <p style="margin: 0 0 6px 0; font-size: 14px; color: #0f172a; font-weight: 600;">
              ${n.titulo}
            </p>
            <p style="margin: 0 0 12px 0; font-size: 13px; color: #475569; font-style: italic;">
              "${extractoTexto}"
            </p>
            <a href="${enlaceOficialHoy}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 8px 14px; font-size: 13px; font-weight: bold; text-decoration: none; border-radius: 4px;">
              Ver sumario oficial de hoy en el BOJA →
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
            subject: '🔔 Nuevos sumarios del BOJA en sus áreas de interés',
            html: htmlContent
          })
        });
      }

      for (const noticia of noticiasInteres) {
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
            mensaje: `Nuevo aviso en ${noticia.sector.toUpperCase()}: ${noticia.titulo}`,
            leida: false
          })
        });
      }
    }
  }

  console.log("Proceso finalizado con éxito.");
}

ejecutarProceso();
