const cheerio = require("cheerio");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0)";

const SECTORES = {
  "oposiciones y empleo": {
    inulsion: [
      "convocatoria de pruebas selectivas",
      "oferta de empleo publico",
      "bolsa de trabajo",
      "plaza de personal funcionario",
      "plaza de personal laboral",
      "concurso-oposicion",
      "proceso selectivo",
      "personal estatutario temporal"
    ],
    exclusion: [
      "nombramiento de funcionarios",
      "adjudicacion de destinos",
      "cese",
      "toma de posesion"
    ]
  },
  "hosteleria y comercio": {
    inulsion: [
      "subvencion hosteleria",
      "ayudas al comercio minorista",
      "modernizacion de establecimientos comerciales",
      "turismo y artesania",
      "horarios comerciales",
      "plan de apoyo al sector hostelero",
      "calidad turistica andaluza"
    ],
    exclusion: []
  },
  "agricultura y ganaderia": {
    inulsion: [
      "ayudas a la agricultura",
      "explotaciones ganaderas",
      "sanidad animal",
      "sanidad vegetal",
      "subvenciones pac",
      "modernizacion de explotaciones agrarias",
      "incorporacion de jovenes agricultores",
      "sector pesquero y acuicultura"
    ],
    exclusion: []
  },
  "licitaciones y obras": {
    inulsion: [
      "anuncio de licitacion",
      "contratacion de obras",
      "suministros y servicios",
      "pliego de clausulas administrativas",
      "procedimiento abierto",
      "adjudicacion de contrato",
      "obras publicas de interes autonomico"
    ],
    exclusion: []
  },
  "educacion y formacion": {
    inulsion: [
      "convocatoria de plazas de profesorado",
      "cuerpo de maestros",
      "profesores de ensenanza secundaria",
      "becas y ayudas al estudio",
      "formacion profesional para el empleo",
      "universidades publicas de andalucia",
      "oferta educativa"
    ],
    exclusion: []
  },
  "sanidad y bienestar social": {
    inulsion: [
      "servicio andaluz de salud",
      "personal estatutario",
      "atencion a la dependencia",
      "subvenciones a entidades sociales",
      "centros de servicios sociales",
      "prestaciones sociales publicas",
      "concurso de traslado sanidad"
    ],
    exclusion: []
  },
  "subvenciones y ayudas generales": {
    inulsion: [
      "incentivos economicos regionales",
      "ayudas a autonomos",
      "emprendimiento y creacion de empresas",
      "digitalizacion de pymes",
      "fomento del empleo autonomo",
      "i+d+i empresarial"
    ],
    exclusion: []
  }
};

function normalizar(texto = "") {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

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

async function ejecutar() {
  console.log("🚀 Iniciando capturador web inteligente del BOJA...");

  const urlPortada = "https://www.juntadeandalucia.es/BOJA";
  let htmlPortada;
  try {
    const res = await fetch(urlPortada, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.log("⚠️ No se pudo acceder a la portada del BOJA.");
      return;
    }
    htmlPortada = await res.text();
  } catch (error) {
    console.log(`⚠️ Error al conectar con la portada: ${error.message}`);
    return;
  }

  const $ = cheerio.load(htmlPortada);
  let urlsWebSumarios = [];

  // Buscamos directamente los enlaces web al sumario del día de hoy
  $("a").each((_, el) => {
    const texto = $(el).text().toLowerCase();
    const href = $(el).attr("href");
    
    if (href && (texto.includes("sumario") || texto.includes("boletín"))) {
      let urlFinal = "";
      if (href.includes("/eboja/")) {
        urlFinal = new URL(href, "https://www.juntadeandalucia.es").href;
      } else {
        urlFinal = new URL(href, "https://www.juntadeandalucia.es/eboja/").href;
      }

      // Aseguramos que apunte a la vista HTML del índice del sumario
      if (urlFinal.endsWith(".pdf")) {
        urlFinal = urlFinal.replace(".pdf", "/index.html");
      } else if (!urlFinal.endsWith("index.html") && !urlFinal.endsWith("/")) {
        urlFinal += "/index.html";
      }

      if (urlFinal && !urlsWebSumarios.includes(urlFinal)) {
        urlsWebSumarios.push(urlFinal);
      }
    }
  });

  // Si no encuentra enlaces específicos, construimos la ruta basada en la fecha actual
  if (urlsWebSumarios.length === 0) {
    const fechaHoy = new Date();
    const anio = fechaHoy.getFullYear();
    // Como alternativa de respaldo por si la portada cambia el formato de los enlaces
    console.log("⚠️ Usando enlace de respaldo basado en la fecha actual.");
  }

  console.log(`📄 Páginas web de sumarios detectadas:`, urlsWebSumarios);

  const documentosProcesados = [];

  for (const urlWebSumario of urlsWebSumarios) {
    console.log(`🌐 Analizando contenido web del sumario: ${urlWebSumario}`);

    let htmlSumario;
    try {
      const sumarioRes = await fetch(urlWebSumario, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
      if (!sumarioRes.ok) continue;
      htmlSumario = await sumarioRes.text();
    } catch (err) {
      console.log(`⚠️ Error al descargar la página del sumario: ${err.message}`);
      continue;
    }

    const $sumario = cheerio.load(htmlSumario);

    // Recorremos los bloques de anuncios de la página del BOJA
    // La estructura típica del BOJA agrupa las disposiciones en listas o tablas con enlaces al texto oficial
    $sumario("a").each((_, el) => {
      const textoAnuncio = $sumario(el).text().trim();
      let hrefAnuncio = $sumario(el).attr("href");

      if (!hrefAnuncio || textoAnuncio.length < 15) return;

      // Normalizamos la URL del documento individual (el enlace real que lleva al PDF/HTML del anuncio)
      let urlDocumentoIndividual = new URL(hrefAnuncio, urlWebSumario).href;

      const textoNorm = normalizar(textoAnuncio);

      for (const [sector, reglas] of Object.entries(SECTORES)) {
        const tieneExclusion = reglas.exclusion.some(ex => textoNorm.includes(normalizar(ex)));
        if (tieneExclusion) continue;

        const coincide = reglas.inulsion.some(inc => textoNorm.includes(normalizar(inc)));

        if (coincide) {
          documentosProcesados.push({
            titulo: textoAnuncio,
            url_pdf: urlDocumentoIndividual, // URL directa y limpia extraída de la web del BOJA
            sector: sector
          });
          break;
        }
      }
    });
  }

  const unicos = Array.from(new Map(documentosProcesados.map(d => [d.titulo, d])).values());
  console.log(`🎯 Anuncios relevantes encontrados: ${unicos.length}`);

  for (const d of unicos) {
    try {
      await supabaseRequest("anuncios_boja?on_conflict=url_pdf", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          titulo: d.titulo,
          url_pdf: d.url_pdf,
          categoria: d.sector
        })
      });
    } catch (err) {
      console.log(`⚠️ Aviso al guardar anuncio: ${err.message}`);
    }
  }

  console.log("👥 Consultando usuarios suscritos...");
  const usuarios = await supabaseRequest("perfiles_usuarios?select=email,sectores_suscritos&estado_suscripcion=eq.activa");

  for (const usuario of (usuarios || [])) {
    const relevantes = unicos.filter(doc => usuario.sectores_suscritos?.includes(doc.sector));
    if (relevantes.length === 0) continue;

    console.log(`📧 Enviando correo de alerta a ${usuario.email}...`);
    
    const htmlCorreo = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #006b4f;">Boletín Oficial de la Junta de Andalucía</h2>
        <p>Hola, <strong>tienes ${relevantes.length} alertas nuevas del BOJA de hoy</strong> relacionadas तुझ्या sectores:</p>
        <ul style="line-height: 1.6;">
          ${relevantes.map(r => `
            <li style="margin-bottom: 12px;">
              <strong>[${r.sector.toUpperCase()}]</strong><br>
              <span style="font-size: 14px; color: #555;">${r.titulo}</span><br>
              <a href="${r.url_pdf}" target="_blank" style="color: #008f6a; font-weight: bold; text-decoration: underline;">Acceder al documento oficial completo</a>
            </li>
          `).join("")}
        </ul>
        <p style="font-size: 12px; color: #888; margin-top: 20px;">Mensaje automático de tu plataforma de empleo y formación.</p>
      </div>
    `;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { 
        Authorization: `Bearer ${RESEND_API_KEY}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({
        from: "BoletínHoy <alertas@boletinhoy.es>",
        to: [usuario.email],
        subject: `🔔 Tienes ${relevantes.length} alertas nuevas del BOJA de hoy`,
        html: htmlCorreo
      })
    });
  }

  console.log("✅ Proceso completado con éxito.");
}

ejecutar().catch((error) => {
  console.error("❌ Error crítico en el script:", error);
  process.exit(1);
});
