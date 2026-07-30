const cheerio = require("cheerio");
const pdfParse = require("pdf-parse");

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
      "personal estatutario temporal",
      "proteccion laboral",
      "medidas urgentes"
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
      "modernizacion de establecimientos",
      "turismo y artesania",
      "horarios comerciales",
      "plan de apoyo al sector hostelero",
      "calidad turistica andaluza",
      "calidad turistica"
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
      "modernizacion de explotaciones",
      "incorporacion de jovenes agricultores",
      "sector pesquero"
    ],
    exclusion: []
  },
  "licitaciones y obras": {
    inulsion: [
      "anuncio de licitacion",
      "contratacion de obras",
      "suministros y servicios",
      "pliego",
      "procedimiento abierto",
      "adjudicacion de contrato",
      "obras publicas"
    ],
    exclusion: []
  },
  "educacion y formacion": {
    inulsion: [
      "convocatoria de plazas",
      "profesorado",
      "cuerpo de maestros",
      "becas y ayudas",
      "formacion profesional",
      "universidades"
    ],
    exclusion: []
  },
  "sanidad y bienestar social": {
    inulsion: [
      "personal estatutario",
      "atencion a la dependencia",
      "subvenciones a entidades sociales",
      "prestaciones sociales",
      "servicio andaluz de salud"
    ],
    exclusion: []
  },
  "subvenciones y ayudas generales": {
    inulsion: [
      "incentivos economicos",
      "ayudas a autonomos",
      "emprendimiento",
      "digitalizacion",
      "fomento del empleo",
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
  let todosLosNuevosAnuncios = [];

  // ==========================================
  // 1. CAPTURA DEL BOJA
  // ==========================================
  console.log("🚀 Iniciando capturador inteligente del BOJA...");

  const urlPortadaBoja = "https://www.juntadeandalucia.es/BOJA";
  try {
    const res = await fetch(urlPortadaBoja, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const htmlPortada = await res.text();
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

      console.log(`📄 PDFs de sumarios oficiales BOJA detectados:`, urlsPdfSumarios);

      for (const urlPdfSumario of urlsPdfSumarios) {
        try {
          const pdfRes = await fetch(urlPdfSumario, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
          if (!pdfRes.ok) continue;
          const buffer = Buffer.from(await pdfRes.arrayBuffer());
          const parsedPdf = await pdfParse(buffer);
          const lineas = parsedPdf.text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

          for (let i = 0; i < lineas.length; i++) {
            const lineaNorm = normalizar(lineas[i]);
            for (const [sector, reglas] of Object.entries(SECTORES)) {
              if (reglas.exclusion.some(ex => lineaNorm.includes(normalizar(ex)))) continue;
              if (reglas.inulsion.some(inc => lineaNorm.includes(normalizar(inc)))) {
                todosLosNuevosAnuncios.push({
                  titulo: lineas[i],
                  url_pdf: urlPdfSumario,
                  sector: sector,
                  origen: "BOJA"
                });
                break;
              }
            }
          }
        } catch (err) {
          console.log(`⚠️ Error procesando PDF BOJA: ${err.message}`);
        }
      }
    }
  } catch (error) {
    console.log(`⚠️ Error al conectar con portada BOJA: ${error.message}`);
  }

  // ==========================================
  // 2. CAPTURA DEL BOE
  // ==========================================
  console.log("🚀 Iniciando extracción del BOE...");
  const urlBoe = "https://www.boe.es/diario_boe/ultimo.php";

  try {
    const resBoe = await fetch(urlBoe, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (resBoe.ok) {
      const htmlBoe = await resBoe.text();
      const $boe = cheerio.load(htmlBoe);

      $boe("a").each((_, el) => {
        const textoEnlace = $boe(el).text();
        const href = $boe(el).attr("href");

        if (href && textoEnlace.includes("PDF (BOE")) {
          const urlPdfIndividual = href.startsWith("http") ? href : new URL(href, "https://www.boe.es").href;
          const bloquePadre = $boe(el).closest("div").parent();
          let tituloTexto = bloquePadre.text()
            .replace(/PDF.*|Otros formatos.*/gi, "")
            .replace(/\s+/g, " ")
            .trim();

          if (tituloTexto && tituloTexto.length > 10) {
            const tituloNorm = normalizar(tituloTexto);
            for (const [sector, reglas] of Object.entries(SECTORES)) {
              if (reglas.exclusion.some(ex => tituloNorm.includes(normalizar(ex)))) continue;
              if (reglas.inulsion.some(inc => tituloNorm.includes(normalizar(inc)))) {
                todosLosNuevosAnuncios.push({
                  titulo: tituloTexto,
                  url_pdf: urlPdfIndividual,
                  sector: sector,
                  origen: "BOE"
                });
                break;
              }
            }
          }
        }
      });
    }
  } catch (err) {
    console.log(`⚠️ Error al conectar con el BOE: ${err.message}`);
  }

  const unicos = Array.from(new Map(todosLosNuevosAnuncios.map(d => [d.titulo, d])).values());
  console.log(`🎯 Total anuncios relevantes combinados (BOJA + BOE): ${unicos.length}`);

  // Guardar en Supabase marcando enviado = false
  for (const d of unicos) {
    try {
      await supabaseRequest("anuncios_boja?on_conflict=url_pdf", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          titulo: d.titulo,
          url_pdf: d.url_pdf,
          categoria: d.sector,
          origen: d.origen,
          enviado: false
        })
      });
    } catch (err) {
      console.log(`⚠️ Aviso al guardar anuncio: ${err.message}`);
    }
  }

  // ==========================================
  // 3. ENVÍO DE CORREOS UNIFICADOS
  // ==========================================
  console.log("👥 Consultando usuarios suscritos...");
  const usuarios = await supabaseRequest("perfiles_usuarios?select=email,sectores_suscritos&estado_suscripcion=eq.activa");

  for (const usuario of (usuarios || [])) {
    const relevantes = unicos.filter(doc => usuario.sectores_suscritos?.includes(doc.sector));
    if (relevantes.length === 0) continue;

    console.log(`📧 Enviando correo unificado a ${usuario.email} (${relevantes.length} alertas)...`);
    
    const htmlCorreo = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #006b4f;">Boletines Oficiales (BOJA y BOE)</h2>
        <p>Hola, <strong>tienes ${relevantes.length} alertas nuevas de hoy</strong> relacionadas con tus sectores:</p>
        <ul style="line-height: 1.6;">
          ${relevantes.map(r => `
            <li style="margin-bottom: 12px;">
              <strong>[${r.origen}] - [${r.sector.toUpperCase()}]</strong><br>
              <span style="font-size: 14px; color: #555;">${r.titulo}</span><br>
              <a href="${r.url_pdf}" target="_blank" style="color: #008f6a; font-weight: bold; text-decoration: underline;">Ver documento PDF oficial</a>
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
        subject: `🔔 Tienes ${relevantes.length} alertas nuevas del BOJA y BOE de hoy`,
        html: htmlCorreo
      })
    });
  }

  // Marcar como enviados en Supabase
  const titulosEnviados = unicos.map(a => a.titulo);
  if (titulosEnviados.length > 0) {
    try {
      await supabaseRequest("anuncios_boja?titulo=in.(" + titulosEnviados.map(t => `"${t}"`).join(",") + ")", {
        method: "PATCH",
        body: JSON.stringify({ enviado: true })
      });
    } catch (e) {
      console.log("⚠️ No se pudieron marcar algunos registros como enviados.");
    }
  }

  console.log("✅ Proceso completo BOJA y BOE finalizado con éxito.");
}

ejecutar().catch((error) => {
  console.error("❌ Error crítico en el script:", error);
  process.exit(1);
});
