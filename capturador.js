import pdfParse from "pdf-parse";
import * as cheerio from "cheerio";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0)";

const SECTORES = {
  "oposiciones y empleo": {
    threshold: 8,
    fuertes: [
      { texto: "se convoca proceso selectivo", puntos: 10 },
      { texto: "convocatoria de pruebas selectivas", puntos: 10 },
      { texto: "se convocan pruebas selectivas", puntos: 10 },
      { texto: "convocatoria para el acceso", puntos: 9 },
      { texto: "convocatoria para ingreso", puntos: 9 },
      { texto: "convocatoria de concurso-oposicion", puntos: 10 },
      { texto: "se convoca concurso-oposicion", puntos: 10 },
      { texto: "creacion de una bolsa de trabajo", puntos: 10 },
      { texto: "ampliacion de la bolsa de trabajo", puntos: 10 },
      { texto: "se convoca la bolsa", puntos: 9 },
      { texto: "bolsa extraordinaria", puntos: 9 },
      { texto: "bolsa unica", puntos: 8 },
      { texto: "oferta de empleo publico", puntos: 9 },
      { texto: "sistema general de acceso libre", puntos: 8 },
      { texto: "turno libre", puntos: 7 },
      { texto: "oposicion libre", puntos: 9 },
      { texto: "plazas de personal funcionario de carrera", puntos: 9 },
      { texto: "plazas de personal laboral fijo", puntos: 9 },
      { texto: "seleccion temporal", puntos: 8 },
      { texto: "contratacion temporal", puntos: 7 }
    ],
    medias: [
      { texto: "proceso selectivo", puntos: 4 },
      { texto: "pruebas selectivas", puntos: 4 },
      { texto: "concurso-oposicion", puntos: 5 },
      { texto: "bolsa de trabajo", puntos: 5 },
      { texto: "bolsa de empleo", puntos: 5 },
      { texto: "aspirantes", puntos: 2 },
      { texto: "personas admitidas y excluidas", puntos: 3 },
      { texto: "tribunal calificador", puntos: 3 },
      { texto: "bases de la convocatoria", puntos: 4 },
      { texto: "plazo de presentacion de solicitudes", puntos: 4 }
    ],
    combinaciones: [
      { todos: ["convoca", "plaza", "acceso libre"], puntos: 7 },
      { todos: ["convoca", "bolsa", "seleccion temporal"], puntos: 8 },
      { todos: ["proceso selectivo", "presentacion de solicitudes"], puntos: 7 }
    ],
    negativas: [
      { texto: "se nombra personal funcionario", puntos: -12 },
      { texto: "nombramiento de funcionarios", puntos: -10 },
      { texto: "adjudicacion de destinos", puntos: -10 },
      { texto: "toma de posesion", puntos: -10 },
      { texto: "cese", puntos: -8 }
    ],
    excluirSiContiene: [
      "procedimiento disciplinario",
      "expediente disciplinario",
      "sentencia judicial"
    ]
  },
  "hosteleria y comercio": {
    threshold: 8,
    fuertes: [
      { texto: "subvenciones destinadas al comercio minorista", puntos: 10 },
      { texto: "ayudas al comercio minorista", puntos: 10 },
      { texto: "subvenciones destinadas a establecimientos de hosteleria", puntos: 10 },
      { texto: "ayudas al sector hostelero", puntos: 10 },
      { texto: "modernizacion del comercio", puntos: 8 },
      { texto: "modernizacion de establecimientos comerciales", puntos: 9 }
    ],
    medias: [
      { texto: "hosteleria", puntos: 3 },
      { texto: "comercio minorista", puntos: 4 },
      { texto: "establecimiento comercial", puntos: 3 },
      { texto: "restauracion", puntos: 2 },
      { texto: "alojamiento turistico", puntos: 3 }
    ],
    combinaciones: [
      { todos: ["subvencion", "hosteleria"], puntos: 8 },
      { todos: ["ayuda", "comercio minorista"], puntos: 8 }
    ],
    negativas: [
      { texto: "procedimiento sancionador", puntos: -10 },
      { texto: "infraccion administrativa", puntos: -9 },
      { texto: "reintegro de subvenciones", puntos: -6 }
    ],
    excluirSiContiene: ["expediente sancionador en materia de comercio"]
  },
  "agricultura y ganaderia": {
    threshold: 8,
    fuertes: [
      { texto: "ayudas a las explotaciones agrarias", puntos: 10 },
      { texto: "modernizacion de explotaciones agrarias", puntos: 10 },
      { texto: "incorporacion de jovenes agricultores", puntos: 10 },
      { texto: "ayudas directas de la pac", puntos: 10 },
      { texto: "explotaciones ganaderas", puntos: 7 }
    ],
    medias: [
      { texto: "agricultura", puntos: 2 },
      { texto: "ganaderia", puntos: 2 },
      { texto: "pesca", puntos: 2 },
      { texto: "explotacion agraria", puntos: 3 },
      { texto: "explotacion ganadera", puntos: 3 }
    ],
    combinaciones: [
      { todos: ["convocatoria", "ayudas", "explotaciones agrarias"], puntos: 9 },
      { todos: ["subvenciones", "jovenes agricultores"], puntos: 9 }
    ],
    negativas: [
      { texto: "procedimiento sancionador", puntos: -12 },
      { texto: "expediente sancionador", puntos: -12 }
    ],
    excluirSiContiene: ["procedimiento sancionador en materia de agricultura"]
  },
  "licitaciones y obras": {
    threshold: 8,
    fuertes: [
      { texto: "anuncio de licitacion", puntos: 10 },
      { texto: "convocatoria de licitacion", puntos: 10 },
      { texto: "procedimiento abierto", puntos: 8 },
      { texto: "contratacion de obras", puntos: 8 },
      { texto: "presupuesto base de licitacion", puntos: 9 }
    ],
    medias: [
      { texto: "licitacion", puntos: 4 },
      { texto: "contratacion publica", puntos: 4 },
      { texto: "mesa de contratacion", puntos: 4 }
    ],
    combinaciones: [
      { todos: ["contrato", "presentacion de ofertas"], puntos: 8 },
      { todos: ["licitacion", "presupuesto base"], puntos: 8 }
    ],
    negativas: [
      { texto: "formalizacion del contrato", puntos: -7 },
      { texto: "adjudicacion del contrato", puntos: -5 },
      { texto: "prorroga del contrato", puntos: -10 }
    ],
    excluirSiContiene: ["prorroga del contrato de arrendamiento"]
  },
  "educacion y formacion": {
    threshold: 8,
    fuertes: [
      { texto: "becas y ayudas al estudio", puntos: 9 },
      { texto: "convocatoria de becas", puntos: 9 },
      { texto: "formacion profesional para el empleo", puntos: 7 },
      { texto: "subvenciones para planes de formacion", puntos: 8 }
    ],
    medias: [
      { texto: "educacion secundaria", puntos: 3 },
      { texto: "formacion profesional", puntos: 3 },
      { texto: "centro docente", puntos: 2 },
      { texto: "profesorado", puntos: 2 }
    ],
    combinaciones: [
      { todos: ["convocatoria", "becas"], puntos: 8 },
      { todos: ["subvenciones", "planes de formacion"], puntos: 8 }
    ],
    negativas: [
      { texto: "reintegro de becas", puntos: -12 },
      { texto: "cantidades indebidamente percibidas", puntos: -10 }
    ],
    excluirSiContiene: ["reintegro de becas y ayudas al estudio"]
  },
  "sanidad y bienestar social": {
    threshold: 8,
    fuertes: [
      { texto: "prestacion de dependencia", puntos: 7 },
      { texto: "renta minima de insercion social", puntos: 7 },
      { texto: "ingreso minimo vital", puntos: 8 },
      { texto: "subvenciones a entidades sociales", puntos: 9 }
    ],
    medias: [
      { texto: "sanidad", puntos: 2 },
      { texto: "atencion primaria", puntos: 3 },
      { texto: "servicios sociales", puntos: 3 }
    ],
    combinaciones: [
      { todos: ["convocatoria", "subvenciones", "entidades sociales"], puntos: 9 }
    ],
    negativas: [
      { texto: "no ha sido posible notificar", puntos: -12 },
      { texto: "procedimiento sancionador", puntos: -10 }
    ],
    excluirSiContiene: ["a los que no ha sido posible notificar"]
  },
  "subvenciones y ayudas generales": {
    threshold: 9,
    fuertes: [
      { texto: "se convocan subvenciones", puntos: 10 },
      { texto: "se convocan ayudas", puntos: 10 },
      { texto: "convocatoria de subvenciones", puntos: 10 },
      { texto: "convocatoria de ayudas", puntos: 10 },
      { texto: "bases reguladoras para la concesion de subvenciones", puntos: 9 },
      { texto: "extracto de la convocatoria", puntos: 9 }
    ],
    medias: [
      { texto: "subvencion", puntos: 2 },
      { texto: "ayuda", puntos: 1 },
      { texto: "bases reguladoras", puntos: 3 },
      { texto: "pymes", puntos: 3 },
      { texto: "autonomos", puntos: 3 }
    ],
    combinaciones: [
      { todos: ["convocatoria", "subvenciones", "solicitudes"], puntos: 9 },
      { todos: ["bases reguladoras", "personas beneficiarias"], puntos: 7 }
    ],
    negativas: [
      { texto: "reintegro de subvenciones", puntos: -12 },
      { texto: "procedimiento de reintegro", puntos: -12 },
      { texto: "resolucion de concesion", puntos: -5 }
    ],
    excluirSiContiene: ["procedimiento de reintegro de subvenciones"]
  }
};

function normalizar(texto = "") {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function clasificarTexto(texto = "", seccion = "") {
  const textoNorm = normalizar(texto);
  const seccionNorm = normalizar(seccion);
  let mejorSector = null;
  let maxPuntuacion = -999;

  for (const [nombreSector, reglas] of Object.entries(SECTORES)) {
    const tieneExclusionAbsoluta = (reglas.excluirSiContiene || []).some(ex => textoNorm.includes(normalizar(ex)));
    if (tieneExclusionAbsoluta) continue;

    let puntuacion = 0;
    let tieneSenalPrincipal = false;

    for (const fuerte of (reglas.fuertes || [])) {
      if (textoNorm.includes(normalizar(fuerte.texto))) {
        puntuacion += fuerte.puntos;
        tieneSenalPrincipal = true;
      }
    }

    for (const media of (reglas.medias || [])) {
      if (textoNorm.includes(normalizar(media.texto))) {
        puntuacion += media.puntos;
      }
    }

    for (const comb of (reglas.combinaciones || [])) {
      const cumpleTodas = comb.todos.every(t => textoNorm.includes(normalizar(t)));
      if (cumpleTodas) {
        puntuacion += comb.puntos;
        tieneSenalPrincipal = true;
      }
    }

    for (const neg of (reglas.negativas || [])) {
      if (textoNorm.includes(normalizar(neg.texto))) {
        puntuacion += neg.puntos;
      }
    }

    if (!tieneSenalPrincipal && puntuacion < (reglas.threshold || 8)) {
      continue;
    }

    if (puntuacion >= (reglas.threshold || 8) && puntuacion > maxPuntuacion) {
      maxPuntuacion = puntuacion;
      mejorSector = nombreSector;
    }
  }

  return mejorSector;
}

async function supabaseRequest(endpoint, opciones = {}) {
  const res = await FETCH_API(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
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

const FETCH_API = global.fetch;

async function ejecutar() {
  console.log("🚀 Iniciando capturador del BOJA (Analizando PDF de Sumario y extrayendo 'text núm.')...");

  const urlSumarioWeb = "https://www.juntadeandalucia.es/eboja.html";
  let documentosProcesados = [];

  try {
    const res = await FETCH_API(urlSumarioWeb, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.log("⚠️ No se pudo acceder a la página principal del BOJA.");
      return [];
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    // 1. Localizar el enlace al PDF de Sumario ("Sumario Boletín nº...")
    let urlPdfSumario = "";
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      const texto = $(el).text().toLowerCase();
      if (href && href.toLowerCase().endsWith(".pdf") && (texto.includes("sumario") || href.includes("sumario"))) {
        urlPdfSumario = href.startsWith("http") ? href : new URL(href, "https://www.juntadeandalucia.es").href;
      }
    });

    if (!urlPdfSumario) {
      console.log("⚠️ No se encontró el enlace al PDF de Sumario en la web del BOJA.");
      return [];
    }

    console.log(`📄 Descargando PDF de Sumario: ${urlPdfSumario}`);
    const resPdf = await FETCH_API(urlPdfSumario, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20000) });
    if (!resPdf.ok) {
      console.log("⚠️ No se pudo descargar el PDF del sumario.");
      return [];
    }

    const bufferPdf = Buffer.from(await resPdf.arrayBuffer());
    const parsedPdf = await pdfParse(bufferPdf);
    const textoPdf = parsedPdf.text;

    // 2. Analizar el texto del PDF de Sumario línea a línea o mediante bloques de párrafos
    const lineas = textoPdf.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    
    let tituloAcumulado = "";
    for (let i = 0; i < lineas.length; i++) {
      const linea = lineas[i];

      // Acumulamos texto descriptivo de la disposición
      if (linea.length > 15 && !linea.toLowerCase().includes("text núm") && !linea.toLowerCase().includes("text num")) {
        tituloAcumulado += (tituloAcumulado ? " " : "") + linea;
      }

      // Al encontrar una línea que apunta a "text núm. ..." o similar dentro del PDF de sumario
      if (linea.toLowerCase().includes("text núm") || linea.toLowerCase().includes("text num")) {
        if (tituloAcumulado.length > 20) {
          const sectorEncontrado = clasificarTexto(tituloAcumulado, "");
          
          if (sectorEncontrado) {
            // Extraemos el código o número identificativo de la línea de "text núm" para formar el enlace exacto al HTML / PDF específico de disposición
            const matchNum = linea.match(/(?:\d{4}\/\d+|\d+)/g);
            let urlPdfEspecifico = urlPdfSumario;

            // Intentamos buscar si hay un enlace href real incrustado en el HTML del sumario web que coincida con este texto o número
            let enlaceEncontradoWeb = "";
            $("a").each((_, elA) => {
              const textA = $(elA).text();
              const hrefA = $(elA).attr("href");
              if (hrefA && matchNum && matchNum.some(m => textA.includes(m) || hrefA.includes(m))) {
                enlaceEncontradoWeb = hrefA.startsWith("http") ? hrefA : new URL(hrefA, "https://www.juntadeandalucia.es").href;
              }
            });

            if (enlaceEncontradoWeb) {
              urlPdfEspecifico = enlaceEncontradoWeb;
            } else if (matchNum && matchNum.length > 0) {
              // Si no, derivamos el enlace estructurado oficial del BOJA para esa disposición
              const anioActual = new Date().getFullYear();
              urlPdfEspecifico = `https://www.juntadeandalucia.es/eboja/${anioActual}/${matchNum[matchNum.length - 1]}/surg.pdf`;
            }

            documentosProcesados.push({
              titulo: tituloAcumulado,
              url_pdf: urlPdfEspecifico,
              sector: sectorEncontrado,
              origen: "BOJA"
            });
          }
        }
        // Reseteamos el acumulador para la siguiente disposición
        tituloAcumulado = "";
      }
    }

  } catch (err) {
    console.log(`⚠️ Error procesando el sumario del BOJA: ${err.message}`);
  }

  const unicos = Array.from(new Map(documentosProcesados.map(d => [d.url_pdf, d])).values());
  console.log(`🎯 Anuncios relevantes extraídos del Sumario PDF: ${unicos.length}`);

  for (const d of unicos) {
    try {
      await supabaseRequest("anuncios_boja?on_conflict=url_pdf", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          titulo: d.titulo,
          url_pdf: d.url_pdf,
          categoria: d.sector,
          origen: "BOJA",
          enviado: false
        })
      });
    } catch (err) {
      console.log(`⚠️ Aviso al guardar anuncio del BOJA: ${err.message}`);
    }
  }

  return unicos;
}

export { ejecutar as ejecutarBOJA };
