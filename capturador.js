import * as cheerio from "cheerio";
import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0)";

const SECTORES = {
  "Oposiciones y Empleo": {
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
  "Subvenciones y Ayudas": {
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
  },
  "Licitaciones y Contratación": {
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
  "Agricultura y Ganadería": {
    threshold: 3,
    fuertes: [
      { texto: "agricultura", puntos: 4 },
      { texto: "ganaderia", points: 4 },
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
  "Urbanismo y Medio Ambiente": {
    threshold: 3,
    fuertes: [
      { texto: "urbanismo", points: 4 },
      { texto: "medio ambiente", points: 4 },
      { texto: "plan general", points: 4 },
      { texto: "sostenibilidad", points: 4 },
      { texto: "energia", points: 3 },
      { texto: "industrial", points: 3 }
    ],
    medias: [
      { texto: "territorio", points: 2 },
      { texto: "ambiental", points: 2 },
      { texto: "transporte", points: 2 }
    ],
    negativas: [],
    excluirSiContiene: ["nombramiento"]
  },
  "Sanidad y Asuntos Sociales": {
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
  "Educación y Universidades": {
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
  }
};

function normalizar(texto = "") {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function evaluarYGuardar(texto, urlBase, seccion, destino) {
  const textoLimpio = texto.replace(/\s+/g, " ").trim();
  const sectorEncontrado = clasificarTexto(textoLimpio, seccion);

  if (sectorEncontrado) {
    destino.push({
      titulo: textoLimpio, 
      url_pdf: urlBase,
      sector: sectorEncontrado
    });
  }
}

function clasificarTexto(texto, seccion) {
  const textoAnalizar = (seccion + " " + texto).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let mejorSector = null;
  let maxPuntuacion = 0;
  const esEstructura = textoAnalizar.includes("estructura organica") || textoAnalizar.includes("competencias");

  for (const [sector, reglas] of Object.entries(SECTORES)) {
    let puntuacion = 0;
    let descartar = false;

    if (reglas.excluirSiContiene) {
      for (const exc of reglas.excluirSiContiene) {
        if (textoAnalizar.includes(exc.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
          descartar = true;
          break;
        }
      }
    }

    if (descartar) continue;

    if (reglas.fuertes) {
      reglas.fuertes.forEach(r => {
        if (textoAnalizar.includes(r.texto.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
          puntuacion += (r.puntos || r.points || 5);
        }
      });
    }

    if (reglas.medias) {
      reglas.medias.forEach(r => {
        if (textoAnalizar.includes(r.texto.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
          puntuacion += (r.puntos || r.points || 2);
        }
      });
    }
    
    if (esEstructura) {
      const nombreSectorLimpio = sector.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const seccionLimpia = seccion.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const palabrasClaveSector = nombreSectorLimpio.split(" y ");
      for (const palabra of palabrasClaveSector) {
        if (palabra.length > 3 && seccionLimpia.includes(palabra)) {
          puntuacion += reglas.threshold; 
        }
      }
    }

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

async function ejecutarCapturadorBoja() {
  console.log("🔍 [DIAGNÓSTICO RSS] Consultando únicamente s51.xml...");

  const urlTest = "https://www.juntadeandalucia.es/boja/distribucion/s51.xml";
  const documentosProcesados = [];

  try {
    const respuesta = await fetch(urlTest, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000)
    });

    if (!respuesta.ok) {
      console.error(`❌ Error HTTP en RSS s51.xml: ${respuesta.status}`);
      return [];
    }

    const xmlTexto = await respuesta.text();
    const $ = cheerio.load(xmlTexto, { xmlMode: true });

    const totalItems = $("item").length;
    console.log(`📦 Total de <item> encontrados en s51.xml: ${totalItems}`);

    $("item").each((i, item) => {
      const titulo = $(item).find("title").text().trim();
      const enlace = $(item).find("link").text().trim() || $(item).find("guid").text().trim();
      const fecha = $(item).find("pubDate").text().trim() || $(item).find("date").text().trim();

      if (i < 5) {
        console.log(`--- ÍTEM ${i + 1} ---`);
        console.log(`Título: ${titulo}`);
        console.log(`Enlace: ${enlace}`);
        console.log(`Fecha: ${fecha}`);
      }

      if (titulo && enlace) {
        // Probamos a evaluar con tu lógica actual para ver si pasa los filtros
        evaluarYGuardar(titulo, enlace, "JUNTA DE ANDALUCÍA", documentosProcesados);
      }
    });

    console.log(`🎯 Anuncios relevantes capturados tras evaluar s51.xml: ${documentosProcesados.length}`);

  } catch (err) {
    console.error("❌ Excepción al leer el RSS s51.xml:", err.message);
  }

  return documentosProcesados;
}

export { ejecutarCapturadorBoja as ejecutarBOJA };
