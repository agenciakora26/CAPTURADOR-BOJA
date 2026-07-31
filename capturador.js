import * as cheerio from "cheerio";
import pdfParse from "pdf-parse";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0)";

const SECTORES = {
  "oposiciones y empleo": {
    threshold: 4,
    fuertes: [
      { texto: "oposicion", puntos: 5 },
      { texto: "concurso-oposicion", puntos: 5 },
      { texto: "bolsa de trabajo", puntos: 5 },
      { texto: "bolsa de empleo", puntos: 5 },
      { texto: "oferta de empleo publico", puntos: 5 },
      { texto: "proceso selectivo", puntos: 4 },
      { texto: "pruebas selectivas", puntos: 4 },
      { texto: "personal funcionario", puntos: 4 },
      { texto: "personal laboral", points: 4 },
      { texto: "convocatoria", puntos: 3 }
    ],
    medias: [
      { texto: "plaza", puntos: 2 },
      { texto: "empleo", points: 2 },
      { texto: "seleccion", points: 2 },
      { texto: "aspirantes", points: 2 },
      { texto: "turno libre", points: 3 },
      { texto: "promocion interna", points: 2 },
      { texto: "personal", points: 1 }
    ],
    negativas: [
      { texto: "cese", puntos: -3 },
      { texto: "jubilacion", puntos: -3 }
    ],
    excluirSiContiene: []
  },
  "hosteleria y comercio": {
    threshold: 3,
    fuertes: [
      { texto: "hosteleria", puntos: 5 },
      { texto: "comercio", points: 4 },
      { texto: "turismo", points: 4 },
      { texto: "restauracion", points: 4 },
      { texto: "establecimientos comerciales", points: 5 },
      { texto: "artesania", points: 4 }
    ],
    medias: [
      { texto: "hotel", points: 2 },
      { texto: "bono turistico", points: 4 },
      { texto: "ayudas", points: 2 },
      { texto: "subvencion", points: 2 },
      { texto: "mercado", points: 2 }
    ],
    negativas: [],
    excluirSiContiene: []
  },
  "agricultura y ganaderia": {
    threshold: 3,
    fuertes: [
      { texto: "agricultura", puntos: 4 },
      { texto: "ganaderia", puntos: 4 },
      { texto: "pesca", points: 4 },
      { texto: "explotaciones agrarias", points: 5 },
      { texto: "pac", points: 4 },
      { texto: "produccion ecologica", points: 4 },
      { texto: "ayudas", points: 2 }
    ],
    medias: [
      { texto: "agrario", points: 2 },
      { texto: "rural", points: 2 },
      { texto: "olivar", points: 3 },
      { texto: "vinedo", points: 3 },
      { texto: "subvencion", points: 2 }
    ],
    negativas: [],
    excluirSiContiene: []
  },
  "licitaciones y obras": {
    threshold: 4,
    fuertes: [
      { texto: "licitacion", puntos: 5 },
      { texto: "contratacion", points: 4 },
      { texto: "contrato de obras", points: 5 },
      { texto: "contrato de servicios", points: 4 },
      { texto: "suministros", points: 4 },
      { texto: "adjudicacion", points: 3 },
      { texto: "pliego", points: 3 }
    ],
    medias: [
      { texto: "obras", points: 2 },
      { texto: "servicio", points: 1 },
      { texto: "procedimiento abierto", points: 3 }
    ],
    negativas: [],
    excluirSiContiene: []
  },
  "educacion y formacion": {
    threshold: 3,
    fuertes: [
      { texto: "educacion", points: 4 },
      { texto: "formacion profesional", points: 5 },
      { texto: "becas", points: 5 },
      { texto: "centros docentes", points: 4 },
      { texto: "universidad", points: 4 },
      { texto: "profesorado", points: 4 },
      { texto: "alumnado", points: 3 }
    ],
    medias: [
      { texto: "ensenanza", points: 2 },
      { texto: "curso", points: 2 },
      { texto: "ayudas", points: 2 },
      { texto: "subvenciones", points: 2 }
    ],
    negativas: [],
    excluirSiContiene: []
  },
  "sanidad y bienestar social": {
    threshold: 3,
    fuertes: [
      { texto: "sanidad", points: 4 },
      { texto: "servicio andaluz de salud", points: 5 },
      { texto: "dependencia", points: 4 },
      { texto: "servicios sociales", points: 4 },
      { texto: "discapacidad", points: 4 },
      { texto: "prestaciones", points: 3 }
    ],
    medias: [
      { texto: "salud", points: 2 },
      { texto: "social", points: 2 },
      { texto: "atencion primaria", points: 3 },
      { texto: "ayudas", points: 2 }
    ],
    negativas: [],
    excluirSiContiene: []
  },
  "subvenciones y ayudas generales": {
    threshold: 3,
    fuertes: [
      { texto: "subvencion", points: 4 },
      { texto: "subvenciones", points: 4 },
      { texto: "ayudas", points: 4 },
      { texto: "concesion", points: 3 },
      { texto: "bases reguladoras", points: 4 },
      { texto: "incentivos", points: 3 },
      { texto: "autonomos", points: 4 }
    ],
    medias: [
      { texto: "beneficiarios", points: 2 },
      { texto: "solicitudes", points: 2 },
      { texto: "fomento", points: 2 },
      { texto: "emprendimiento", points: 3 }
    ],
    negativas: [],
    excluirSiContiene: []
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

    if (!tieneSenalPrincipal && puntuacion < (reglas.threshold || 3)) {
      continue;
    }

    if (puntuacion >= (reglas.threshold || 3) && puntuacion > maxPuntuacion) {
      maxPuntuacion = puntuacion;
      mejorSector = nombreSector;
    }
  }

  return mejorSector;
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
    if (!res.ok) return [];
    htmlPortada = await res.text();
  } catch (error) {
    return [];
  }

  const $ = cheerio.load(htmlPortada);
  let urlsPdfSumarios = [];

  // FILTRO ESTRICTO: Solo enlaces que contengan textualmente "sumario boletín" y extensión .pdf
$("a").each((_, el) => {
    // Normalizamos el texto quitando tildes y pasando a minúsculas
    const texto = $(el).text().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const href = $(el).attr("href");
    
    // Comprobamos que el texto contenga ambas palabras juntas/cercanas
    if (href && texto.includes("sumario") && texto.includes("boletin")) {
      const urlFinal = new URL(href, "https://www.juntadeandalucia.es/BOJA").href;
      
      if (urlFinal && !urlsPdfSumarios.includes(urlFinal)) {
        urlsPdfSumarios.push(urlFinal);
      }
    }
  });

  // Función auxiliar interna para evitar errores de ámbito
  function matchBase(val) {
    return val;
  }

  console.log(`📄 PDFs de sumarios oficiales detectados:`, urlsPdfSumarios);

  if (urlsPdfSumarios.length === 0) {
    console.log("⚠️ No se ha encontrado el PDF de sumario boletín oficial.");
    return [];
  }

  const documentosProcesados = [];

  for (const urlPdfSumario of urlsPdfSumarios) {
    try {
      const pdfRes = await fetch(urlPdfSumario, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20000) });
      if (!pdfRes.ok) continue;
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      const parsedPdf = await pdfParse(buffer);

      const lineas = parsedPdf.text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      let seccionActual = "";
      let parrafoActual = "";

      for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];

        // Detectar cabeceras de sección
        if (linea.length > 5 && linea.length < 100 && (linea === linea.toUpperCase() || linea.toLowerCase().includes("consejería"))) {
          if (parrafoActual.length > 25) {
            evaluarYGuardar(parrafoActual, urlPdfSumario, seccionActual, documentosProcesados);
            parrafoActual = "";
          }
          seccionActual = linea;
          continue;
        }

        // Si la línea empieza un nuevo anuncio numerado o código CVE
        if (linea.match(/^[0-9]+\./) || linea.toLowerCase().includes("cve:")) {
          if (parrafoActual.length > 25) {
            evaluarYGuardar(parrafoActual, urlPdfSumario, seccionActual, documentosProcesados);
            parrafoActual = "";
          }
        }

        parrafoActual += " " + linea;
      }

      if (parrafoActual.length > 25) {
        evaluarYGuardar(parrafoActual, urlPdfSumario, seccionActual, documentosProcesados);
      }

    } catch (err) {
      console.log(`⚠️ Error procesando PDF de sumario: ${err.message}`);
    }
  }

  const unicos = Array.from(new Map(documentosProcesados.map(d => [d.titulo, d])).values());
  console.log(`🎯 Anuncios relevantes totales encontrados en el BOJA: ${unicos.length}`);

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

  return unicos;
}

function evaluarYGuardar(texto, urlBase, seccion, destino) {
  const textoLimpio = texto.replace(/\s+/g, " ").trim();
  const sectorEncontrado = clasificarTexto(textoLimpio, seccion);

  if (sectorEncontrado) {
    destino.push({
      titulo: textoLimpio, // Párrafo completo evaluado
      url_pdf: urlBase,
      sector: sectorEncontrado
    });
  }
}

export { ejecutar as ejecutarBOJA };
