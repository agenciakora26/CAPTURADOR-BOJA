const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("ERROR CRÍTICO: Las variables de entorno de Supabase no están configuradas.");
  process.exit(1);
}

// Función auxiliar para extraer un fragmento limpio de contexto (sin mostrar la palabra clave técnica)
function obtenerExtracto(texto, longitudMax = 120) {
  if (!texto) return "Se ha publicado un nuevo documento oficial de su interés en el boletín.";
  if (texto.length <= longitudMax) return texto;
  return texto.substring(0, longitudMax) + "...";
}

// Genera un enlace directo al buscador oficial del BOJA filtrando por palabra clave y limitando a la fecha de hoy
function obtenerEnlaceBusquedaPorDia(sector) {
  const terminosPorSector = {
    oposiciones: "oposiciones",
    agricultura: "agricultura",
    licitaciones: "licitaciones",
    hosteleria: "turismo",
    subvenciones: "subvenciones",
    medioambiente: "medio ambiente",
    sanidad: "sanidad",
    educacion: "educacion"
  };

  const terminoBusqueda = terminosPorSector[sector] || sector;
  
  // Obtenemos la fecha de hoy en formato AAAA-MM-DD para acotar la búsqueda al día actual si el buscador lo soporta,
  // o bien lanzamos la consulta directa optimizada del buscador oficial con el término del sector.
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  const fechaActual = `${anio}-${mes}-${dia}`;

  // URL del buscador oficial del BOJA con la consulta del sector y fecha actual integrada
  return `https://www.juntadeandalucia.es/eboja/buscador/search.do?eboja=on&q=${encodeURIComponent(terminoBusqueda)}&fecha1=${fechaActual}`;
}

async function ejecutarProceso() {
  console.log("Iniciando comprobación del BOJA y filtrado por sectores...");

  // Base de datos de noticias analizadas hoy (aquí se cruzarían los datos reales del scraping del BOJA)
  const noticiasBojaHoy = [
    {
      titulo: "Resolución de convocatorias públicas y ayudas sectoriales",
      sector: "subvenciones",
      textoCompleto: "Se ha publicado un nuevo documento oficial con las bases reguladoras y extractos de interés económico..."
    },
    {
      titulo: "Disposiciones oficiales en materia de personal y servicios",
      sector: "sanidad",
      textoCompleto: "Se han registrado nuevas resoluciones y nombramientos oficiales dentro del ámbito de los servicios públicos..."
    },
    {
      titulo: "Convocatorias de empleo público y plazas",
      sector: "oposiciones",
      textoCompleto: "Se anuncia la apertura de plazos para la presentación de solicitudes en procesos selectivos..."
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

  for (const usuario of usuarios) {
    if (!usuario.sectores_suscritos || usuario.sectores_suscritos.length === 0) continue;

    // Filtramos las noticias que coinciden con los diferentes sectores a los que esté suscrito el usuario
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
            <p style="color: #334155; font-size: 15px;">Hoy hemos encontrado nuevos documentos y sumarios en el BOJA que corresponden a tus áreas de interés:</p>
            
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
      `;
      
      // Recorremos cada sector en el que tenga interés el usuario para desglosárselo de forma independiente
      noticiasInteres.forEach(n => {
        let iconoSector = "📌";
        let mensajeSector = "Nuevo documento de interés:";
        
        switch (n.sector) {
          case 'oposiciones':
            iconoSector = "📢";
            mensajeSector = "Hoy en su campo de <strong>Oposiciones y Empleo Público</strong> tiene esto:";
            break;
          case 'agricultura':
            iconoSector = "🚜";
            mensajeSector = "Hoy en su campo de <strong>Agricultura y Ganadería</strong> tiene esto:";
            break;
          case 'licitaciones':
            iconoSector = "🏗️";
            mensajeSector = "Hoy en su campo de <strong>Licitaciones y Obras Públicas</strong> tiene esto:";
            break;
          case 'hosteleria':
            iconoSector = "🍽️";
            mensajeSector = "Hoy en su campo de <strong>Hostelería, Comercio y Turismo</strong> tiene esto:";
            break;
          case 'subvenciones':
            iconoSector = "💶";
            mensajeSector = "Hoy en su campo de <strong>Subvenciones y Autónomos</strong> tiene esto:";
            break;
          case 'medioambiente':
            iconoSector = "🌿";
            mensajeSector = "Hoy en su campo de <strong>Medio Ambiente y Sostenibilidad</strong> tiene esto:";
            break;
          case 'sanidad':
            iconoSector = "🏥";
            mensajeSector = "Hoy en su campo de <strong>Sanidad y Servicios Sociales</strong> tiene esto:";
            break;
          case 'educacion':
            iconoSector = "🎓";
            mensajeSector = "Hoy en su campo de <strong>Educación y Universidades</strong> tiene esto:";
            break;
          default:
            iconoSector = "📌";
            mensajeSector = `Hoy en su campo de <strong>${n.sector}</strong> tiene esto:`;
            break;
        }

        // Extraemos un fragmento limpio y profesional sin mostrar términos internos de administración
        const extractoTexto = obtenerExtracto(n.textoCompleto);
        // Generamos el enlace directo al buscador con los documentos del día filtrados para este sector
        const enlaceSectorHoy = obtenerEnlaceBusquedaPorDia(n.sector);

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
            <a href="${enlaceSectorHoy}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 8px 14px; font-size: 13px; font-weight: bold; text-decoration: none; border-radius: 4px;">
              Ver documentos oficiales de hoy →
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
            mensaje: `Nuevo documento en ${noticia.sector.toUpperCase()}: ${noticia.titulo}`,
            leida: false
          })
        });
      }
    }
  }

  console.log("Proceso finalizado con éxito.");
}

ejecutarProceso();
