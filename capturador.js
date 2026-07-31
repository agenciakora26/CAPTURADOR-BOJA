import * as cheerio from "cheerio";
import pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";

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
      { texto: "plaza", points: 2 },
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
    excluirSiContiene: ["nombramiento"]
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
    excluirSiContiene: ["nombramiento"]
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
    excluirSiContiene: ["nombramiento"]
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
    excluirSiContiene: ["nombramiento"]
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
    excluirSiContiene: ["nombramiento"]
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
    excluirSiContiene: ["nombramiento"]
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
    excluirSiContiene: ["nombramiento"]
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

// Asegúrate de que el flujo principal ejecute ambas llamadas:
console.log("🚀 Iniciando proceso unificado BOJA y BOE...");

// 1. Ejecutar el capturador del BOJA
await ejecutarCapturadorBoja();  

// 2. Ejecutar el capturador del BOE
console.log("🚀 Iniciación de extracción mejorada del BOE...");
await ejecutarCapturadorBoe();


// Definimos la función completa donde vive toda la lógica del BOJA
async function ejecutarCapturadorBoja() {
  console.log("🚀 Iniciando capturador inteligente del BOJA...");

  const urlPortada = "https://www.juntadeandalucia.es/BOJA";
  let htmlPortada;
  try {
    const res = await fetch(urlPortada, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    htmlPortada = await res.text();
  } catch (error) {
    console.error("Error al conectar con la portada del BOJA:", error);
    return [];
  }

  const $ = cheerio.load(htmlPortada);
  let urlsPdfSumarios = [];

  // FILTRO ESTRICTO: Solo enlaces que contengan textualmente "sumario boletín" y extensión .pdf
  $("a").each((_, el) => {
    const texto = $(el).text().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const href = $(el).attr("href") || "";
    
    // Buscamos el enlace del sumario
    if (href.endsWith(".pdf") && (texto.includes("sumario") || href.includes("sumario"))) {
      if (href.includes("verificacion")) return;

      let urlFinal = "";
      
      // Si el enlace ya viene completo con http, lo usamos
      if (href.startsWith("http")) {
        urlFinal = href;
      } else {
        // Limpiamos el href de cualquier barra o espacio inicial
        const nombreArchivo = href.split("/").pop().trim();
        
        // Extraemos el año y el número de boletín directamente del nombre del archivo (ej. BOJA26-147-...)
        const matchBoja = nombreArchivo.match(/BOJA(\d{2})-(\d+)-/i);
        
        if (matchBoja) {
          const anio = `20${matchBoja[1]}`; // 26 -> 2026
          const numBoletin = matchBoja[2]; // 147
          
          // Construimos la URL perfecta y exacta respetando la jerarquía de carpetas
          urlFinal = `https://www.juntadeandalucia.es/eboja/${anio}/${numBoletin}/${nombreArchivo}`;
        } else {
          // Fallback por si acaso usando la fecha actual
          const anioActual = new Date().getFullYear();
          urlFinal = `https://www.juntadeandalucia.es/eboja/${anioActual}/${nombreArchivo}`;
        }
      }

      if (urlFinal && !urlsPdfSumarios.includes(urlFinal)) {
        urlsPdfSumarios.push(urlFinal);
      }
    }
  });

  console.log(`📄 PDFs de sumarios oficiales detectados:`, urlsPdfSumarios);

  if (urlsPdfSumarios.length === 0) {
    console.log("⚠️ No se ha encontrado el PDF de sumario boletín oficial.");
    return [];
  }

  return urlsPdfSumarios;
}

  const documentosProcesados = [];

  for (const urlPdfSumario of urlsPdfSumarios) {
    try {
      const pdfRes = await fetch(urlPdfSumario, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20000) });
      if (!pdfRes.ok) continue;
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      
      // Cargamos el PDF con pdfjs-dist para poder extraer texto y enlaces reales
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      const pdfDocument = await loadingTask.promise;

      let lineasConEnlaces = [];

      // Recorremos todas las páginas del PDF del sumario
      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();
        const annotations = await page.getAnnotations();

        // Mapeamos los elementos de texto con sus posiciones (x, y) y su contenido
        const items = textContent.items.map(item => ({
          str: item.str.trim(),
          x: item.transform[4],
          y: item.transform[5]
        })).filter(item => item.str.length > 0);

        // Mapeamos las anotaciones de tipo enlace (las URLs reales que puso la Junta)
        const links = annotations
          .filter(annot => annot.subtype === "Link" && annot.url)
          .map(annot => ({
            url: annot.url,
            x: annot.rect[0],
            y: annot.rect[1]
          }));

        // Unimos cada línea de texto con su enlace correspondiente según su posición en la página
        items.forEach(item => {
          let urlAsociada = urlPdfSumario; // Por defecto el sumario si no encuentra enlace exacto
          
          // Buscamos si hay un enlace en las coordenadas aproximadas de este texto
          const matchLink = links.find(l => Math.abs(l.y - item.y) < 10 && Math.abs(l.x - item.x) < 100);
          if (matchLink) {
            urlAsociada = matchLink.url;
          }

          lineasConEnlaces.push({
            texto: item.str,
            url: urlAsociada
          });
        });
      }

      let seccionActual = "";
      let parrafoActual = "";
      let urlAnuncioEspecifica = urlPdfSumario;

      // Procesamos el listado de líneas unidas a sus URLs
      for (let i = 0; i < lineasConEnlaces.length; i++) {
        const lineaObj = lineasConEnlaces[i];
        const linea = lineaObj.texto;

        // Si esta línea tiene un enlace específico que no es el del sumario general, lo guardamos
        if (lineaObj.url && lineaObj.url !== urlPdfSumario) {
          urlAnuncioEspecifica = lineaObj.url;
        }

        // Ignorar líneas del pie de página de la portada
        if (linea.includes("Depósito legal") || linea.includes("ISSN") || linea === "https://www.juntadeandalucia.es/eboja") {
          continue;
        }

        // Comprobamos si la línea está enteramente en mayúsculas (y tiene tamaño de cabecera)
        const esTodoMayusculas = (linea === linea.toUpperCase()) && /[A-ZÁÉÍÓÚÑ]/.test(linea);
        const esCabecera = linea.length > 3 && linea.length < 120 && esTodoMayusculas;

        if (esCabecera) {
          // Si teníamos un anuncio pendiente de evaluar, lo guardamos antes de cambiar de sección
          if (parrafoActual.length > 25) {
            evaluarYGuardar(parrafoActual, urlAnuncioEspecifica, seccionActual, documentosProcesados);
            parrafoActual = "";
          }
          seccionActual = linea; // Actualizamos la consejería/entidad activa
          continue; // Saltamos la línea en mayúsculas para que no contamine el texto del anuncio
        }

        // 🛑 SALTAR TODA LA SECCIÓN DE NOMBRAMIENTOS
        if (seccionActual.toLowerCase().includes("nombramientos")) {
          parrafoActual = ""; 
          continue;
        }

        // Acumulamos el texto del anuncio (que al tener minúsculas pasará por aquí)
        parrafoActual += " " + linea;

        // Si la línea actual contiene la referencia de páginas o texto, cerramos y evaluamos el anuncio
        if (linea.toLowerCase().includes("texto núm.") || linea.toLowerCase().includes("páginas")) {
          if (parrafoActual.length > 25) {
            evaluarYGuardar(parrafoActual, urlAnuncioEspecifica, seccionActual, documentosProcesados);
            parrafoActual = "";
          }
        }
      }

      // Guardar el último párrafo si queda pendiente
      if (parrafoActual.length > 25) {
        evaluarYGuardar(parrafoActual, urlAnuncioEspecifica, seccionActual, documentosProcesados);
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
