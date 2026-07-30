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
      "calidad turistica"
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
      "obras publicas"
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
      "universidades",
      "oferta educativa"
    ],
    exclusion: []
  },
  "sanidad y bienestar social": {
    color: "#dc2626",
    inulsion: [
      "personal estatutario",
      "atencion a la dependencia",
      "subvenciones a entidades sociales",
      "centros de servicios sociales",
      "prestaciones sociales publicas",
      "sanidad"
    ],
    exclusion: []
  },
  "subvenciones y ayudas generales": {
    color: "#0891b2",
    inulsion: [
      "incentivos economicos",
      "ayudas a autonomos",
      "emprendimiento y creacion de empresas",
      "digitalizacion",
      "fomento del empleo",
      "i+d+i"
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

// --- CAPTURA BOJA ---
async function capturarBOJA() {
  console.log("🚀 Iniciando captura del BOJA...");
  const urlPortada = "https://www.juntadeandalucia.es/BOJA";
  let documentos = [];

  try {
    const res = await fetch(urlPortada, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return documentos;
    const htmlPortada = await res.text();
    const $ = cheerio.load(htmlPortada);
    let urlsPdfSumarios = [];

    $("a").each((_, el) => {
      const texto = $(el).text().toLowerCase();
      const href = $(el).attr("href");
      if (href && texto.includes("sumario boletín")) {
        let urlFinal = href.includes("/eboja/") ? new URL(href, "https://www.juntadeandalucia.es").href : new URL(href.startsWith("/") ? href : `/${href}`, "https://www.juntadeandalucia.es/eboja/").href;
        if (!urlsPdfSumarios.includes(urlFinal)) urlsPdfSumarios.push(urlFinal);
      }
    });

    for (const urlPdfSumario of urlsPdfSumarios) {
      const pdfRes = await fetch(urlPdfSumario, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
      if (!pdfRes.ok) continue;
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

      let lineasGlobales = [];
      let enlacesGlobales = [];

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const annotations = await page.getAnnotations();
        lineasGlobales.push(...textContent.items.map(item => item.str));
        enlacesGlobales.push(...annotations);
      }

      const partesUrl = urlPdfSumario.split('/');
      const urlIndiceBoletin = `https://www.juntadeandalucia.es/eboja/${partesUrl[4]}/${partesUrl[5]}/index.html`;
      let bufferTituloLines = [];

      for (let i = 0; i < lineasGlobales.length; i++) {
        const textoLinea = lineasGlobales[i].trim();
        if (!textoLinea) continue;
        const matchTextoNum = textoLinea.match(/texto\s+n[uú]m\.?\s*(\d+)/i);

        if (matchTextoNum) {
          const numDisposicion = matchTextoNum[1];
          const tituloCompleto = bufferTituloLines.join(" ").replace(/\s+/g, " ").trim();
          
          if (tituloCompleto.length > 15) {
            const tituloNorm = normalizar(tituloCompleto);
            for (const [sector, reglas] of Object.entries(SECTORES)) {
              if (reglas.exclusion.some(ex => tituloNorm.includes(normalizar(ex)))) continue;
              if (reglas.inulsion.some(inc => tituloNorm.includes(normalizar(inc)))) {
                let urlPdfIndividual = urlIndiceBoletin;
                const enlaceReal = enlacesGlobales.find(ann => ann.url && ann.url.includes(numDisposicion) && ann.url.endsWith(".pdf"));
                if (enlaceReal && enlaceReal.url) urlPdfIndividual = enlaceReal.url;

                documentos.push({ titulo: tituloCompleto, url_pdf: urlPdfIndividual, sector: sector, origen: "BOJA" });
                break;
              }
            }
          }
          bufferTituloLines = [];
        } else {
          if (!textoLinea.startsWith("BOLETÍN OFICIAL") && !textoLinea.match(/^\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4}$/i)) {
            bufferTituloLines.push(textoLinea);
          }
        }
      }
    }
  } catch (err) {
    console.log(`⚠️ Error en BOJA: ${err.message}`);
  }
  return Array.from(new Map(documentos.map(d => [d.titulo, d])).values());
}

// --- CAPTURA BOE ---
async function capturarBOE() {
  console.log("🚀 Iniciando captura del BOE desde la última edición...");
  const urlBoe = "https://www.boe.es/diario_boe/ultimo.php";
  let documentos = [];

  try {
    const res = await fetch(urlBoe, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return documentos;
    const html = await res.text();
    const $ = cheerio.load(html);

    // El BOE estructura sus enlaces de sumario en listas de artículos o sumarios por departamento
    $("a").each((_, el) => {
      const texto = $(el).text().replace(/\s+/g, " ").trim();
      const href = $(el).attr("href");

      if (href && (href.includes("BOE-A-") || href.includes("id=BOE-A-")) && texto.length > 20) {
        let urlPdfIndividual = href.startsWith("http") ? href : new URL(href, "https://www.boe.es").href;
        // Transformar si es HTML a PDF del BOE si se desea, o mantener enlace directo
        if (urlPdfIndividual.includes("detallado.php")) {
          urlPdfIndividual = urlPdfIndividual.replace("detallado.php", "pdf.php");
        }

        const tituloNorm = normalizar(texto);
        for (const [sector, reglas] of Object.entries(SECTORES)) {
          if (reglas.exclusion.some(ex => tituloNorm.includes(normalizar(ex)))) continue;
          if (reglas.inulsion.some(inc => tituloNorm.includes(normalizar(inc)))) {
            documentos.push({ titulo: texto, url_pdf: urlPdfIndividual, sector: sector, origen: "BOE" });
            break;
          }
        }
      }
    });
  } catch (err) {
    console.log(`⚠️ Error en BOE: ${err.message}`);
  }
  return Array.from(new Map(documentos.map(d => [d.titulo, d])).values());
}

async function ejecutar() {
  const anunciosBoja = await capturarBOJA();
  const anunciosBoe = await capturarBOE();
  const todosAnuncios = [...anunciosBoja, ...anunciosBoe];

  console.log(`🎯 Total relevantes encontrados -> BOJA: ${anunciosBoja.length} | BOE: ${anunciosBoe.length}`);

  // Guardar en Supabase
  for (const d of todosAnuncios) {
    try {
      await supabaseRequest("anuncios_boja?on_conflict=url_pdf", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          titulo: d.titulo,
          url_pdf: d.url_pdf,
          categoria: d.sector,
          origen: d.origen
        })
      });
    } catch (err) {
      console.log(`⚠️ Aviso al guardar anuncio: ${err.message}`);
    }
  }

  console.log("👥 Consultando usuarios suscritos para envío unificado...");
  const usuarios = await supabaseRequest("perfiles_usuarios?select=email,sectores_suscritos&estado_suscripcion=eq.activa");

  for (const usuario of (usuarios || [])) {
    const relevantesBoja = anunciosBoja.filter(doc => usuario.sectores_suscritos?.includes(doc.sector));
    const relevantesBoe = anunciosBoe.filter(doc => usuario.sectores_suscritos?.includes(doc.sector));

    if (relevantesBoja.length === 0 && relevantesBoe.length === 0) continue;

    console.log(`📧 Enviando correo unificado a ${usuario.email}...`);
    
    const generarBloqueHTML = (lista, tituloSeccion, colorBase) => {
      if (lista.length === 0) return "";
      return `
        <div style="margin-top: 25px; margin-bottom: 15px;">
          <h2 style="font-size: 16px; color: ${colorBase}; border-bottom: 2px solid ${colorBase}; padding-bottom: 6px; margin-bottom: 15px;">
            ${tituloSeccion} (${lista.length})
          </h2>
          ${lista.map(r => {
            const colorSector = SECTORES[r.sector]?.color || colorBase;
            return `
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 5px solid ${colorSector}; border-radius: 6px; padding: 15px; margin-bottom: 15px;">
                <span style="display: inline-block; background-color: ${colorSector}; color: #ffffff; font-size: 11px; font-weight: bold; text-transform: uppercase; padding: 3px 8px; border-radius: 4px; margin-bottom: 10px;">
                  ${r.sector}
                </span>
                <p style="margin: 0 0 12px 0; font-size: 14px; font-weight: 500; color: #1a202c; line-height: 1.4;">
                  ${r.titulo}
                </p>
                <a href="${r.url_pdf}" target="_blank" style="display: inline-block; background-color: #ffffff; color: ${colorSector}; border: 1px solid ${colorSector}; font-size: 12px; font-weight: bold; text-decoration: none; padding: 6px 12px; border-radius: 4px;">
                  📄 Ver documento oficial
                </a>
              </div>
            `;
          }).join("")}
        </div>
      `;
    };

    const htmlCorreo = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #f4f6f8; padding: 30px 10px; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
          <div style="background-color: #006b4f; color: #ffffff; padding: 25px 30px; text-align: left;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 600;">BoletínHoy - Resumen Oficial Diario</h1>
            <p style="margin: 5px 0 0 0; font-size: 14px; color: #e2fcf5;">Actualidad conjunta de BOJA y BOE adaptada a tus intereses</p>
          </div>
          <div style="padding: 25px;">
            <p style="margin-top: 0; font-size: 15px; color: #2d3748;">Hola,</p>
            <p style="font-size: 14px; color: #4a5568; line-height: 1.5;">Aquí tienes las novedades publicadas hoy en los boletines oficiales correspondientes a tus sectores suscritos:</p>

            ${generarBloqueHTML(relevantesBoja, "🟢 Boletín Oficial de la Junta de Andalucía (BOJA)", "#006b4f")}
            ${generarBloqueHTML(relevantesBoe, "🔵 Boletín Oficial del Estado (BOE)", "#2563eb")}

            <p style="font-size: 13px; color: #718096; margin-top: 30px; border-top: 1px solid #edf2f7; padding-top: 15px;">
              Mensaje automático generado por BoletínHoy. Por favor, no respondas a este correo.
            </p>
          </div>
        </div>
      </div>
    `;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "BoletínHoy <alertas@boletinhoy.es>",
        to: [usuario.email],
        subject: `🔔 Tus alertas del día: ${relevantesBoja.length + relevantesBoe.length} nuevas disposiciones`,
        html: htmlCorreo
      })
    });
  }

  console.log("✅ Proceso unificado completado con éxito.");
}

ejecutar().catch((error) => {
  console.error("❌ Error crítico en el script:", error);
  process.exit(1);
});
