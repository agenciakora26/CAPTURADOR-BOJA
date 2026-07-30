const cheerio = require("cheerio");
const pdfjsLib = "pdfjs-dist/legacy/build/pdf.js" in require ? require("pdfjs-dist/legacy/build/pdf.js") : require("pdfjs-dist");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0)";

const SECTORES = {
  "oposiciones y empleo": {
    color: "#006b4f",
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
    color: "#d97706",
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
    color: "#16a34a",
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
    color: "#2563eb",
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
    color: "#7c3aed",
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
    color: "#dc2626",
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
    color: "#0891b2",
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
  console.log("🚀 Iniciando capturador inteligente del BOJA en GitHub...");

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
  let urlsPdfSumarios = [];

  $("a").each((_, el) => {
    const texto = $(el).text().toLowerCase();
    const href = $(el).attr("href");
    
    if (href && texto.includes("sumario boletín")) {
      let urlFinal = "";
      if (href.includes("/eboja/")) {
        urlFinal = new URL(href, "https://www.juntadeandalucia.es").href;
      } else {
        const cleanHref = href.startsWith("/") ? href : `/${href}`;
        const matchAnio = cleanHref.match(/BOJA(\d{2})-(\d+)-/);
        if (matchAnio) {
          const anioCompleto = `20${matchAnio[1]}`;
          const numBoletin = parseInt(matchAnio[2], 10);
          urlFinal = `https://www.juntadeandalucia.es/eboja/${anioCompleto}/${numBoletin}/${cleanHref.split('/').pop()}`;
        } else {
          urlFinal = new URL(cleanHref, "https://www.juntadeandalucia.es/eboja/").href;
        }
      }
      if (urlFinal && !urlsPdfSumarios.includes(urlFinal)) {
        urlsPdfSumarios.push(urlFinal);
      }
    }
  });

  console.log(`📄 PDFs de sumarios oficiales detectados:`, urlsPdfSumarios);

  if (urlsPdfSumarios.length === 0) {
    console.log("⚠️ No se ha podido extraer ningún PDF de sumario boletín.");
    return;
  }

  const documentosProcesados = [];

  for (const urlPdfSumario of urlsPdfSumarios) {
    console.log(`📄 Descargando y leyendo hipervínculos del Sumario oficial: ${urlPdfSumario}`);

    try {
      const pdfRes = await fetch(urlPdfSumario, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
      if (!pdfRes.ok) continue;
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      const pdfDoc = await loadingTask.promise;

      let lineasGlobales = [];
      let enlacesGlobales = [];

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const annotations = await page.getAnnotations();

        let itemsPagina = textContent.items.map(item => item.str);
        lineasGlobales.push(...itemsPagina);
        enlacesGlobales.push(...annotations);
      }

      const textoUnido = lineasGlobales.join("\n");
      const lineas = textoUnido.split("\n").map(l => l.trim()).filter(l => l.length > 0);

      const partesUrl = urlPdfSumario.split('/');
      const anio = partesUrl[4];
      const numBoletin = partesUrl[5];
      const urlIndiceBoletin = `https://www.juntadeandalucia.es/eboja/${anio}/${numBoletin}/index.html`;

      console.log(`🔍 Analizando ${lineas.length} líneas y extrayendo enlaces incrustados...`);

      for (let i = 0; i < lineas.length; i++) {
        const lineaNorm = normalizar(lineas[i]);

        for (const [sector, reglas] of Object.entries(SECTORES)) {
          const tieneExclusion = reglas.exclusion.some(ex => lineaNorm.includes(normalizar(ex)));
          if (tieneExclusion) continue;

          const coincide = reglas.inulsion.some(inc => lineaNorm.includes(normalizar(inc)));

          if (coincide) {
            let urlPdfIndividual = urlIndiceBoletin;

            for (let j = i; j < Math.min(i + 6, lineas.length); j++) {
              const matchTextoNum = lineas[j].match(/texto\s+n[uú]m\.?\s*(\d+)/i);
              if (matchTextoNum) {
                const numDisposicion = matchTextoNum[1];
                const enlaceReal = enlacesGlobales.find(ann => ann.url && ann.url.includes(numDisposicion) && ann.url.endsWith(".pdf"));
                if (enlaceReal && enlaceReal.url) {
                  urlPdfIndividual = enlaceReal.url;
                }
                break;
              }
            }

            documentosProcesados.push({
              titulo: lineas[i],
              url_pdf: urlPdfIndividual,
              sector: sector
            });
            break;
          }
        }
      }

    } catch (err) {
      console.log(`⚠️ Error al procesar el PDF con pdfjs: ${err.message}`);
      continue;
    }
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
    
    // Diseño HTML moderno, limpio y visualmente atractivo tipo tarjeta
    const htmlCorreo = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #f4f6f8; padding: 30px 10px; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
          
          <!-- Cabecera del correo -->
          <div style="background-color: #006b4f; color: #ffffff; padding: 25px 30px; text-align: left;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 600; letter-spacing: 0.5px;">Boletín Oficial de la Junta de Andalucía</h1>
            <p style="margin: 5px 0 0 0; font-size: 14px; color: #e2fcf5;">Resumen diario de convocatorias y alertas personalizadas</p>
          </div>

          <!-- Cuerpo principal -->
          <div style="padding: 30px;">
            <p style="margin-top: 0; font-size: 16px; color: #2d3748;">Hola,</p>
            <p style="font-size: 15px; color: #4a5568; line-height:.5;">Se han publicado <strong>${relevantes.length} nuevas disposiciones</strong> hoy que coinciden con los sectores a los que estás suscrito:</p>

            <div style="margin-top: 25px;">
              ${relevantes.map(r => {
                const colorSector = SECTORES[r.sector]?.color || "#006b4f";
                return `
                  <div style="background-color: #f8fafc; border-left: 4px solid ${colorSector}; border: 1px solid #e2e8f0; border-left-width: 5px; border-radius: 6px; padding: 18px; margin-bottom: 20px;">
                    <span style="display: inline-block; background-color: ${colorSector}; color: #ffffff; font-size: 11px; font-weight: bold; text-transform: uppercase; padding: 4px 10px; border-radius: 4px; margin-bottom: 10px; letter-spacing: 0.5px;">
                      ${r.sector}
                    </span>
                    <p style="margin: 0 0 14px 0; font-size: 15px; font-weight: 500; color: #1a202c; line-height: 1.5;">
                      ${r.titulo}
                    </p>
                    <a href="${r.url_pdf}" target="_blank" style="display: inline-block; background-color: #ffffff; color: ${colorSector}; border: 1px solid ${colorSector}; font-size: 13px; font-weight: bold; text-decoration: none; padding: 8px 16px; border-radius: 4px; transition: all 0.2s;">
                      📄 Ver documento oficial completo
                    </a>
                  </div>
                `;
              }).join("")}
            </div>

            <p style="font-size: 14px; color: #718096; margin-top: 30px; border-top: 1px solid #edf2f7; padding-top: 20px;">
              Este es un mensaje automático generado por tu plataforma de empleo y formación. Por favor, no respondas a este correo.
            </p>
          </div>

        </div>
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
        subject: `🔔 Tienes ${relevantes.length} nuevas alertas del BOJA de hoy`,
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
