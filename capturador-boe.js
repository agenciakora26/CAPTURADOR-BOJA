const cheerio = "cheerio" in globalThis ? require("cheerio") : require("cheerio");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
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
      "adjudicacion de contrato"
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
      "dependencia",
      "subvenciones a entidades sociales",
      "prestaciones sociales",
      "proteccion social"
    ],
    exclusion: []
  },
  "subvenciones y ayudas generales": {
    inulsion: [
      "incentivos economicos",
      "ayudas a autonomos",
      "emprendimiento",
      "digitalizacion",
      "fomento del empleo"
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

async function ejecutarBOE() {
  console.log("🚀 Iniciando rastreo optimizado del BOE...");
  const urlBoe = "https://www.boe.es/diario_boe/ultimo.php";
  let documentos = [];

  try {
    const res = await fetch(urlBoe, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.log("⚠️ No se pudo acceder a la portada del BOE.");
      return;
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    let totalEnlacesPdfEncontrados = 0;

    // Buscamos directamente cualquier etiqueta 'a' que contenga el texto del PDF oficial
    $("a").each((_, el) => {
      const textoEnlace = $(el).text();
      const href = $(el).attr("href");

      if (href && textoEnlace.includes("PDF (BOE")) {
        totalEnlacesPdfEncontrados++;
        const urlPdfIndividual = href.startsWith("http") ? href : new URL(href, "https://www.boe.es").href;

        // El título descriptivo en la estructura del BOE suele encontrarse en el elemento de bloque previo (p.ej. un párrafo anterior)
        // Buscamos el texto analizando el contenedor padre o el hermano anterior
        let contenedor = $(el).closest("div, p");
        let tituloTexto = "";

        if (contenedor.length) {
          // Extraemos el texto del bloque eliminando los botones de enlaces y formatos
          const clone = contenedor.clone();
          clone.find("a, span, img, strong").remove();
          tituloTexto = clone.text().replace(/\s+/g, " ").trim();

          // Si el texto queda muy corto, buscamos en el texto completo del bloque contenedor
          if (tituloTexto.length < 15) {
            tituloTexto = contenedor.text().replace(/PDF.*|Otros formatos.*/gi, "").replace(/\s+/g, " ").trim();
          }
        }

        // Método alternativo si el anterior no captura suficiente texto: buscar en el bloque padre general
        if (!tituloTexto || tituloTexto.length < 15) {
          const parentBlock = $(el).parent().parent();
          tituloTexto = parentBlock.text().replace(/PDF.*|Otros formatos.*/gi, "").replace(/\s+/g, " ").trim();
        }

        console.log(`🔎 [BOE Encontrado] Título extraído: "${tituloTexto.substring(0, 60)}..."`);

        if (tituloTexto && tituloTexto.length > 10) {
          const tituloNorm = normalizar(tituloTexto);

          for (const [sector, reglas] of Object.entries(SECTORES)) {
            const tieneExclusion = reglas.exclusion.some(ex => tituloNorm.includes(normalizar(ex)));
            if (tieneExclusion) continue;

            const coincide = reglas.inulsion.some(inc => tituloNorm.includes(normalizar(inc)));

            if (coincide) {
              documentos.push({
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

    console.log(`📌 Total de enlaces de PDF oficiales analizados en el BOE: ${totalEnlacesPdfEncontrados}`);

  } catch (err) {
    console.log(`⚠️ Error al conectar con el BOE: ${err.message}`);
  }

  const unicos = Array.from(new Map(documentos.map(d => [d.titulo, d])).values());
  console.log(`🎯 Anuncios relevantes encontrados en el BOE: ${unicos.length}`);

  for (const d of unicos) {
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
      console.log(`⚠️ Aviso al guardar anuncio del BOE: ${err.message}`);
    }
  }
  console.log("✅ Proceso del BOE finalizado.");
}

ejecutarBOE().catch((error) => {
  console.error("❌ Error crítico en el capturador del BOE:", error);
  process.exit(1);
});
