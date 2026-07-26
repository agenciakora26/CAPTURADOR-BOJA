const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("ERROR CRÍTICO: Las variables de entorno de Supabase no están configuradas.");
  process.exit(1);
}

async function ejecutarProceso() {
  console.log("Iniciando comprobación del BOJA...");

  const noticiasBojaHoy = [
    {
      titulo: "Convocatoria de ayudas y subvenciones",
      sector: "subvenciones",
      enlace: "https://www.juntadeandalucia.es/boja/..."
    }
  ];

  if (!noticiasBojaHoy || noticiasBojaHoy.length === 0) {
    console.log("El BOJA aún no está disponible.");
    process.exit(0);
  }

  // Obtener usuarios desde Supabase usando fetch REST API directamente
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
      let htmlContent = `<p>Hola <strong>${usuario.nombre}</strong>, hay nuevas publicaciones en el BOJA para tus sectores:</p><ul>`;
      noticiasInteres.forEach(n => {
        htmlContent += `<li><a href="${n.enlace}" target="_blank">${n.titulo}</a></li>`;
      });
      htmlContent += `</ul><p>Atentamente,<br>Equipo de BoletínHoy</p>`;

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
            subject: 'Nuevas Alertas del BOJA',
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
