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

function evaluarYGuardar(texto, urlBase, seccion, destino) {
  const textoLimpio = texto.replace(/\s+/g, " ").trim();
  
  console.log(`🔎 Evaluando texto (${textoLimpio.length} chars) [${seccion}]: "${textoLimpio.substring(0, 80)}..."`);
  
  const sectorEncontrado = clasificarTexto(textoLimpio, seccion);

  if (sectorEncontrado) {
    console.log(`✅ ¡Anuncio clasificado en "${sectorEncontrado}"!`);
    destino.push({
      titulo: textoLimpio, 
      url_pdf: urlBase,
      sector: sectorEncontrado
    });
  } else {
    console.log(`❌ Descartado (no alcanza umbral o no coincide con sectores).`);
  }
}

function clasificarTexto(texto, seccion) {
  // Unimos la cabecera (Consejería) y el texto para evaluar el contexto completo
  const textoAnalizar = (seccion + " " + texto).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  let mejorSector = null;
  let maxPuntuacion = 0;

  // Detectamos si es un decreto de estructura de los boletines extraordinarios
  const esEstructura = textoAnalizar.includes("estructura organica") || textoAnalizar.includes("competencias");

  for (const [sector, reglas] of Object.entries(SECTORES)) {
    let puntuacion = 0;
    let descartar = false;

    // Comprobamos palabras excluyentes
    if (reglas.excluirSiContiene) {
      for (const exc of reglas.excluirSiContiene) {
        if (textoAnalizar.includes(exc.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
          descartar = true;
          break;
        }
      }
    }

    if (descartar) continue;

    // Evaluamos palabras fuertes
    if (reglas.fuertes) {
      reglas.fuertes.forEach(r => {
        if (textoAnalizar.includes(r.texto.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
          puntuacion += (r.puntos || r.points || 5);
        }
      });
    }

    // Evaluamos palabras medias
    if (reglas.medias) {
      reglas.medias.forEach(r => {
        if (textoAnalizar.includes(r.texto.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
          puntuacion += (r.puntos || r.points || 2);
        }
      });
    }
    
    // BONUS: Si es un decreto organizativo, buscamos si el nombre de la consejería coincide con tu sector
    if (esEstructura) {
      const nombreSectorLimpio = sector.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const seccionLimpia = seccion.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      
      // Separamos el nombre del sector (ej: "agricultura y ganaderia" -> "agricultura", "ganaderia")
      const palabrasClaveSector = nombreSectorLimpio.split(" y ");
      for (const palabra of palabrasClaveSector) {
        // Si la palabra clave (ej. Agricultura, Empleo, Sanidad) está en el nombre de la Consejería, aprueba directo
        if (palabra.length > 3 && seccionLimpia.includes(palabra)) {
          puntuacion += reglas.threshold; 
        }
      }
    }

    // Guardamos el sector con mayor puntuación que supere su umbral
    if (puntuacion >= reglas.threshold && puntuacion > maxPuntuacion) {
      maxPuntuacion = puntuacion;
      mejorSector = sector;
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

  $("a").each((_, el) => {
    const texto = $(el).text().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const href = $(el).attr("href") || "";
    
    if (href.endsWith(".pdf") && (texto.includes("sumario") || href.includes("sumario"))) {
      if (href.includes("verificacion")) return;

      let urlFinal = "";
      if (href.startsWith("http")) {
        urlFinal = href;
      } else {
        const nombreArchivo = href.split("/").pop().trim();
        const matchBoja = nombreArchivo.match(/BOJA(\d{2})-(\d+)-/i);
        
        if (matchBoja) {
          const anio = `20${matchBoja[1]}`; 
          const numBoletin = matchBoja[2]; 
          urlFinal = `https://www.juntadeandalucia.es/eboja/${anio}/${numBoletin}/${nombreArchivo}`;
        } else {
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

  const documentosProcesados = [];

  for (const urlPdfSumario of urlsPdfSumarios) {
    try {
      const pdfRes = await fetch(urlPdfSumario, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20000) });
      if (!pdfRes.ok) continue;
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      const pdfDocument = await loadingTask.promise;

      let lineasConEnlaces = [];

      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();
        const annotations = await page.getAnnotations();

        const items = textContent.items.map(item => ({
          str: item.str.trim(),
          x: item.transform[4],
          y: item.transform[5]
        })).filter(item => item.str.length > 0);

        const links = annotations
          .filter(annot => annot.subtype === "Link" && annot.url)
          .map(annot => ({
            url: annot.url,
            x: annot.rect[0],
            y: annot.rect[1]
          }));

        items.forEach(item => {
          let urlAsociada = urlPdfSumario; 
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

     let seccionActual = "GENERAL";
      let parrafoActual = "";
      let urlAnuncioEspecifica = urlPdfSumario;

      for (let i = 0; i < lineasConEnlaces.length; i++) {
        const lineaObj = lineasConEnlaces[i];
        const linea = lineaObj.texto;

        if (lineaObj.url && lineaObj.url !== urlPdfSumario) {
          urlAnuncioEspecifica = lineaObj.url;
        }

        if (
          linea.includes("Depósito legal") || 
          linea.includes("ISSN") || 
          linea.includes("Sumario") || 
          linea.includes("Extraordinario") || 
          linea.includes("Boletín Oficial") ||
          linea === "https://www.juntadeandalucia.es/eboja" ||
          linea === "Junta de Andalucía" ||
          linea === "BOJA"
        ) {
          continue;
        }

        const esTodoMayusculas = (linea === linea.toUpperCase()) && /[A-ZÁÉÍÓÚÑ]/.test(linea);
        const esCabecera = linea.length > 3 && linea.length < 100 && esTodoMayusculas;

        if (esCabecera) {
          if (parrafoActual.length > 15) {
            evaluarYGuardar(parrafoActual, urlAnuncioEspecifica, seccionActual, documentosProcesados);
            parrafoActual = "";
          }
          seccionActual = linea; 
          continue; 
        }

        if (seccionActual.toLowerCase().includes("nombramientos")) {
          parrafoActual = ""; 
          continue;
        }

        parrafoActual += " " + linea;

        if (parrafoActual.length > 120) {
          evaluarYGuardar(parrafoActual, urlAnuncioEspecifica, seccionActual, documentosProcesados);
          parrafoActual = "";
        }
      }

      if (parrafoActual.length > 15) {
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



// Exportación única al final del archivo
export { ejecutarCapturadorBoja as ejecutarBOJA };
