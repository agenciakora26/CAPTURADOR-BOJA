const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("ERROR CRÍTICO: Las variables de entorno de Supabase no están llegando a Node.js.");
  console.error("SUPABASE_URL:", supabaseUrl ? "OK" : "FALTA");
  console.error("SUPABASE_KEY:", supabaseKey ? "OK" : "FALTA");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

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

  const { data: usuarios, error } = await supabase.from('perfiles_usuarios').select('*');
  if (error) {
    console.error("Error al obtener usuarios:", error.message);
    process.exit(1);
  }

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
        await supabase.from('notificaciones_web').insert([
          {
            usuario_id: usuario.id,
            mensaje: `Nuevo aviso en ${noticia.sector.toUpperCase()}: ${noticia.titulo}`,
            leida: false
          }
        ]);
      }
    }
  }

  console.log("Proceso finalizado con éxito.");
}

ejecutarProceso();
