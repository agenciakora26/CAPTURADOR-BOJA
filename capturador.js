const cheerio = require("cheerio");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const BASE_BOJA = "https://www.juntadeandalucia.es/eboja";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0)";

// Sectores, palabras clave de inclusión y términos de exclusión
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
  console.log("🚀 Iniciando capturador inteligente del BOJA...");

  const urlPortada = "https://www.juntadeandalucia.es/BOJA";
  
  let htmlPortada;
  try {
    const resPortada = await fetch(urlPortada, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!resPortada.ok) return;
    htmlPortada = await resPortada.text();
  } catch (error) {
    console.log(`⚠️ Error al conectar con la portada: ${error.message}`);
    return;
  }

  // 1. Obtener la URL del sumario HTML del día actual dinámicamente
  const $portada = cheerio.load(htmlPortada);
  let urlIndice = null;

  $portada("a").each((_, el) => {
    const texto = $portada(el).text();
    const href = $portada(el).attr("href");
    if (texto && texto.toLowerCase().includes("sumario boletín") && href) {
      const urlAbsoluta = new URL(href, urlPortada).href;
      if (!urlAbsoluta.toLowerCase().endsWith(".pdf")) {
        urlIndice = urlAbsoluta;
        return false;
      }
    }
  });

  if (!urlIndice) {
    console.log("⚠️ No se ha encontrado el enlace del 'Sumario boletín'.");
    return;
  }

  console.log(`🔗 Sumario detectado: ${urlIndice}`);

  let htmlSumario;
  try {
    const resSumario = await fetch(urlIndice, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!resSumario.ok) return;
    htmlSumario = await resSumario.text();
  } catch (error) {
    console.log(`⚠️ Error al descargar el sumario: ${error.message}`);
    return;
  }

  const $ = cheerio.load(htmlSumario);
  const documentosProcesados = [];

  // 2. Analizar bloques de texto del sumario aplicando inclusión y exclusión
  $("p, div").each((_, el) => {
    const textoBloque = $(el).text().trim();
    if (textoBloque.length < 30) return;

    const textoNorm = normalizar(textoBloque);

    for (const [sector, reglas] of Object.entries(SECTORES)) {
      // Comprobar si contiene alguna palabra de exclusión (si las tiene)
      const tieneExclusion = reglas.exclusion.some(ex => textoNorm.includes(normalizar(ex)));
      if (tieneExclusion) continue; // Descartamos este bloque si tiene términos prohibidos

      // Comprobar si cumple con las palabras clave de inclusión
      const coincide = reglas.inulsion.some(inc => textoNorm.includes(normalizar(inc)));
      
      if (coincide) {
        let urlPdf = null;
        $(el).find("a").each((_, aEl) => {
          const hrefA = $(aEl).attr("href");
          if (hrefA && hrefA.toLowerCase().includes(".pdf")) {
            urlPdf = new URL(hrefA, urlIndice).href;
          }
        });

        if (!urlPdf) {
          const siguienteEnlace = $(el).nextAll("a[href*='.pdf']").first();
          if (siguienteEnlace.length > 0) {
            urlPdf = new URL(siguienteEnlace.attr("href"), urlIndice).href;
          }
        }

        if (urlPdf) {
          documentosProcesados.push({
            titulo: textoBloque.substring(0, 120) + "...",
            url_pdf: urlPdf,
            sector: sector
          });
        }
        break;
      }
    }
  });

  const unicos = Array.from(new Map(documentosProcesados.map(d => [d.url_pdf, d])).values());
  console.log(`🔍 Anuncios relevantes filtrados por sectores: ${unicos.length}`);

  // 3. Guardar en Supabase
  if (unicos.length > 0) {
    await supabaseRequest("anuncios_boja?on_conflict=url_pdf", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(unicos.map(d => ({
        titulo: d.titulo,
        url_pdf: d.url_pdf,
        categoria: d.sector
      })))
    });
  }

  // 4. Consultar usuarios y enviar correos personalizados
  console.log("👥 Consultando usuarios suscritos...");
  const usuarios = await supabaseRequest("perfiles_usuarios?select=email,sectores_suscritos&estado_suscripcion=eq.activa");

  for (const usuario of (usuarios || [])) {
    const relevantes = unicos.filter(doc => usuario.sectores_suscritos?.includes(doc.sector));

    if (relevantes.length === 0) continue;

    console.log(`📧 Enviando correo a ${usuario.email} con ${relevantes.length} alertas...`);
    
    const htmlCorreo = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #006b4f;">Boletín Oficial de la Junta de Andalucía</h2>
        <p>Hola, <strong>tienes ${relevantes.length} alertas nuevas del BOJA de hoy</strong> relacionadas con tus sectores de interés:</p>
        <ul style="line-height: 1.6;">
          ${relevantes.map(r => `
            <li style="margin-bottom: 12px;">
              <strong>[${r.sector.toUpperCase()}]</strong><br>
              <span style="font-size: 14px; color: #555;">${r.titulo}</span><br>
              <a href="${r.url_pdf}" target="_blank" style="color: #008f6a; font-weight: bold; text-decoration: underline;">Ver documento PDF oficial</a>
            </li>
          `).join("")}
        </ul>
        <p style="font-size: 12px; color: #888; margin-top: 20px;">Este es un mensaje automático de tu plataforma de empleo y formación.</p>
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

  console.log("✅ Proceso de análisis y envío finalizado correctamente.");
}

ejecutar().catch((error) => {
  console.error("❌ Error crítico en el script:", error);
  process.exit(1);
});
