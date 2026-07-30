const cheerio = require("cheerio");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

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
  console.log("🚀 Iniciando capturador inteligente del BOJA...");

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
    console.log(`📄 Descargando y analizando hipervínculos del Sumario oficial: ${urlPdfSumario}`);

    try {
      const pdfRes = await fetch(urlPdfSumario, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
      if (!pdfRes.ok) continue;
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      const pdfDoc = await loadingTask.promise;

      let textoPaginas = [];
      let enlacesPorPagina = [];

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const annotations = await page.getAnnotations();

        // Extraer líneas de texto con coordenadas aproximadas
        let lineasPagina = textContent.items.map(item => ({
          str: item.str,
          transform: item.transform // [scaleX, skewY, skewX, scaleY, x, y]
        }));

        textoPaginas.push(lineasPagina);
        enlacesPorPagina.push(annotations);
      }

      // Procesamiento unificado de texto y enlaces anidados
      let textoCompletoPlano = [];
      let enlacesMapeados = [];

      for (let p = 0; p < pdfDoc.numPages; p++) {
        const lineas = textoPaginas[p];
        const annotations = enlacesPorPagina[p];

        // Unimos el texto linealmente para buscar coincidencias
        let textoStr = lineas.map(l => l.str).join("\n");
        let lineasArray = textoStr.split("\n").map(l => l.trim()).filter(l => l.length > 0);

        for (let i = 0; i < lineasArray.length; i++) {
          const lineaNorm = normalizar(lineasArray[i]);

          for (const [sector, reglas] of Object.entries(SECTORES)) {
            const tieneExclusion = reglas.exclusion.some(ex => lineaNorm.includes(normalizar(ex)));
            if (tieneExclusion) continue;

            const coincide = reglas.inulsion.some(inc => lineaNorm.includes(normalizar(inc)));

            if (coincide) {
              // Buscamos el enlace "texto núm." más cercano en las anotaciones de la misma página o en líneas de texto próximas
              let urlPdfIndividual = urlPdfSumario;

              for (let j = i; j < Math.min(i + 6, lineasArray.length); j++) {
                const matchTextoNum = lineasArray[j].match(/texto\s+n[uú]m\.?\s*(\d+)/i);
                if (matchTextoNum) {
                  const numDisposicion = matchTextoNum[1];
                  
                  // Buscamos en las anotaciones de la página un enlace que contenga ese número de disposición
                  const enlaceEncontrado = annotations.find(ann => ann.url && ann.url.includes(numDisposicion));
                  if (enlaceEncontrado && enlaceEncontrado.url) {
                    urlPdfIndividual = enlaceEncontrado.url;
                  } else {
                    // Fallback inteligente si la anotación directa no expone la URL completa
                    const partesUrl = urlPdfSumario.split('/');
                    const anio = partesUrl[4];
                    const numBoletin = partesUrl[5];
                    // Patrón aproximado de la URL del BOJA si se conoce el patrón base
                    urlPdfIndividual = `https://www.juntadeandalucia.es/eboja/${anio}/${numBoletin}/`;
                  }
                  break;
                }
              }

              documentosProcesados.push({
                titulo: lineasArray[i],
                url_pdf: urlPdfIndividual,
                sector: sector
              });
              break;
            }
          }
        }
      }

    } catch (err) {
      console.log(`⚠️ Error al procesar anotaciones del PDF: ${err.message}`);
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
    
    const htmlCorreo = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #006b4f;">Boletín Oficial de la Junta de Andalucía</h2>
        <p>Hola, <strong>tienes ${relevantes.length} alertas nuevas del BOJA de hoy</strong> relacionadas con tus sectores:</p>
        <ul style="line-height: 1.6;">
          ${relevantes.map(r => `
            <li style="margin-bottom: 12px;">
              <strong>[${r.sector.toUpperCase()}]</strong><br>
              <span style="font-size: 14px; color: #555;">${r.titulo}</span><br>
              <a href="${r.url_pdf}" target="_blank" style="color: #008f6a; font-weight: bold; text-decoration: underline;">Ver documento PDF oficial de este anuncio</a>
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
