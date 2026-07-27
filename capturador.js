const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("ERROR CRÍTICO: Las variables de entorno de Supabase no están configuradas.");
  process.exit(1);
}

// Función auxiliar para extraer un fragmento de texto alrededor de la palabra clave
function obtenerExtracto(texto, palabraClave, longitudMax = 120) {
  if (!texto) return "Nueva publicación oficial disponible en el boletín.";
  const index = texto.toLowerCase().indexOf(palabraClave.toLowerCase());
  if (index === -1) return texto.substring(0, longitudMax) + "...";
  
  const inicio = Math.max(0, index - 40);
  const fin = Math.min(texto.length, index + longitudMax);
  let fragmento = texto.substring(inicio, fin);
  if (inicio > 0) fragmento = "..." + fragmento;
  if (fin < texto.length) fragmento = fragmento + "...";
  return fragmento;
}

async function ejecutarProceso() {
  console.log("Iniciando comprobación del BOJA...");

  const noticiasBojaHoy = [
    {
      titulo: "Convocatoria de ayudas y subvenciones para pymes",
      sector: "subvenciones",
      enlace: "https://www.juntadeandalucia.es/eboja/...",
      textoCompleto: "Se ha aprobado una nueva línea de subvenciones destinadas a impulsar la digitalización de pymes y autónomos en Andalucía..."
    }
  ];

  if (!noticiasBojaHoy || noticiasBojaHoy.length === 0) {
    console.log("El BOJA aún no está disponible.");
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

    const noticiasInteres = noticiasBojaHoy.filter(n => usuario.sectores_suscritos.includes(n.sector));

    if (noticiasInteres.length > 0) {
      // Diseño HTML visual tipo tarjeta con contenedor limpio
      let htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8fafc; padding: 20px; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0;">🚀 BoletínHoy</h2>
            <p style="color: #64748b; font-size: 14px; margin-top: 5px;">Tus alertas personalizadas del BOJA</p>
          </div>
          
          <div style="background-color: #ffffff; padding: 20px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <p style="color: #334155; font-size: 15px;">Hola <strong>Estimado/a suscriptor/a</strong>,</p>
            <p style="color: #334155; font-size: 15px;">Tenemos novedades oficiales muy importantes en el BOJA que coinciden con tus áreas de interés:</p>
            
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
      `;
      
      noticiasInteres.forEach(n => {
        let iconoSector = "📌";
        let mensajeSector = "hay una nueva publicación:";
        
        switch (n.sector) {
          case 'oposiciones':
            iconoSector = "📢";
            mensajeSector = "Se ha publicado una nueva convocatoria u oferta de empleo público:";
            break;
          case 'agricultura':
            iconoSector = "🚜";
            mensajeSector = "Hay novedades oficiales sobre el sector agrario, PAC o ayudas al campo:";
            break;
          case 'licitaciones':
            iconoSector = "🏗️";
            mensajeSector = "Se ha abierto un nuevo concurso público u oportunidad de contratación:";
            break;
          case 'hosteleria':
            iconoSector = "🍽️";
            mensajeSector = "Hay nuevas normativas, ayudas o resoluciones para hostelería y turismo:";
            break;
          case 'subvenciones':
            iconoSector = "💶";
            mensajeSector = "Ya están disponibles nuevas líneas de ayudas y subvenciones:";
            break;
          case 'medioambiente':
            iconoSector = "🌿";
            mensajeSector = "Se han registrado nuevas declaraciones o normativas medioambientales:";
            break;
          case 'sanidad':
            iconoSector = "🏥";
            mensajeSector = "Hay resoluciones recientes en materia de sanidad y servicios sociales:";
            break;
          case 'educacion':
            iconoSector = "🎓";
            mensajeSector = "Se ha publicado una nueva convocatoria, beca o disposición educativa:";
            break;
          default:
            iconoSector = "📌";
            mensajeSector = `Hay una actualización oficial en el sector de <strong>${n.sector}</strong>:`;
            break;
        }

        const extractoTexto = obtenerExtracto(n.textoCompleto || n.titulo, n.sector);

        htmlContent += `
          <div style="margin-bottom: 25px; background: #f8fafc; padding: 15px; border-left: 4px solid #2563eb; border-radius: 4px;">
            <p style="margin: 0 0 8px 0; font-size: 15px; color: #1e293b; font-weight: bold;">
              ${iconoSector} ${mensajeSector}
            </p>
            <p style="margin: 0 0 12px 0; font-size: 14px; color: #475569; font-style: italic;">
              "${extractoTexto}"
            </p>
            <a href="${n.enlace}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 8px 14px; font-size: 13px; font-weight: bold; text-decoration: none; border-radius: 4px;">
              Ver disposición en el BOJA →
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
            subject: '🔔 Nuevas Alertas Personalizadas del BOJA',
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
