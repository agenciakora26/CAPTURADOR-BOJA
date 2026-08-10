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
  console.log("🚀 Extrayendo anuncios del BOJA usando la URL fija por fecha del día...");

  const urlBase = "https://www.juntadeandalucia.es";
  
  // 1. Generamos la fecha de hoy en formato YYYYMMDD
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm = String(hoy.getMonth() + 1).padStart(2, '0');
  const dd = String(hoy.getDate()).padStart(2, '0');
  const fechaFormateada = `${yyyy}${mm}${dd}`;
  
  const urlDia = `${urlBase}/eboja/${fechaFormateada}.html`;
  console.log(`🔗 Accediendo a los boletines de hoy en: ${urlDia}`);

  let htmlDia = "";
  try {
    const resDia = await fetch(urlDia, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000)
    });

    if (!resDia.ok) {
      console.log(`⚠️ No se encontró boletín publicado para la fecha ${fechaFormateada} (status ${resDia.status}).`);
      return [];
    }

    htmlDia = await resDia.text();
  } catch (error) {
    console.error("❌ Excepción al conectar con la página del día del BOJA:", error.message);
    return [];
  }

  // 2. Leemos las URLs absolutas correctas asegurando el prefijo /eboja/
  const $dia = cheerio.load(htmlDia);
  const urlsBoletinesHoy = new Set();

  $dia("a").each((_, el) => {
    let href = $dia(el).attr("href") || "";
    let texto = $dia(el).text().toLowerCase();

    if (href && !href.endsWith(".pdf") && (href.includes(`/${yyyy}/`) || texto.includes("boletín"))) {
      // Corregimos URLs relativas asegurando el prefijo /eboja/ si no viene en el href
      let urlAbsoluta = "";
      if (href.startsWith("http")) {
        urlAbsoluta = href;
      } else if (href.startsWith("/eboja/")) {
        urlAbsoluta = urlBase + href;
      } else if (href.startsWith("/")) {
        urlAbsoluta = `${urlBase}/eboja${href}`;
      } else {
        urlAbsoluta = `${urlBase}/eboja/${href}`;
      }
      
      urlsBoletinesHoy.add(urlAbsoluta);
    }
  });

  const listaBoletines = Array.from(urlsBoletinesHoy);
  console.log(`📌 Se han encontrado ${listaBoletines.length} boletín(es) para el día de hoy:`, listaBoletines);

  if (listaBoletines.length === 0) {
    console.log("📭 No hay enlaces a boletines en la página del día.");
    return [];
  }

  const documentosProcesados = [];

  // 3. Recorremos cada boletín del día y extraemos todos los bloques de disposiciones
  for (const urlBoletin of listaBoletines) {
    try {
      console.log(`🔗 Analizando sumario: ${urlBoletin}`);
      const resSumario = await fetch(urlBoletin, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(20000)
      });

      if (!resSumario.ok) continue;

      const htmlSumario = await resSumario.text();
      const $ = cheerio.load(htmlSumario);

      // Buscamos enlaces a PDF o contenedores de disposiciones en la página
      $("a[href*='.pdf']").each((_, el) => {
        let href = $(el).attr("href") || "";
        if (href.includes("sumario") || href.includes("verificacion")) return;

        let urlPdfFinal = href.startsWith("http") ? href : urlBase + (href.startsWith("/") ? href : "/" + href);
        
        // Tomamos el texto del elemento padre contenedor para garantizar la frase completa
        let bloquePadre = $(el).closest("p, li, div").text().replace(/\s+/g, " ").trim();

        // Si el contenedor padre es muy corto, usamos el texto directo del enlace
        let tituloAnuncio = bloquePadre.length > 30 ? bloquePadre : $(el).text().replace(/\s+/g, " ").trim();

        // Limpiamos los textos de botones accisorios de la interfaz web
        tituloAnuncio = tituloAnuncio
          .replace(/PDF oficial auténtico/gi, "")
          .replace(/Otros formatos/gi, "")
          .replace(/Verificar autenticidad/gi, "")
          .replace(/texto núm\..*$/gi, "")
          .replace(/páginas?.*$/gi, "")
          .trim();

        if (tituloAnuncio.length > 20) {
          evaluarYGuardar(tituloAnuncio, urlPdfFinal, "JUNTA DE ANDALUCÍA", documentosProcesados);
        }
      });

    } catch (err) {
      console.log(`⚠️ Error al leer el boletín en ${urlBoletin}: ${err.message}`);
    }
  }

  const unicos = Array.from(new Map(documentosProcesados.map(d => [d.titulo, d])).values());
  console.log(`🎯 Anuncios relevantes capturados en el BOJA de hoy: ${unicos.length}`);

  // 4. Guardado en Supabase
  for (const d of unicos) {
    try {
      await supabaseRequest("anuncios_boja?on_conflict=url_pdf", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          titulo: d.titulo,
          url_pdf: d.url_pdf,
          categoria: d.sector,
          origen: "BOJA"
        })
      });
    } catch (err) {
      console.log(`⚠️ Aviso al guardar en Supabase: ${err.message}`);
    }
  }

  return unicos;
}

export { ejecutarCapturadorBoja as ejecutarBOJA };
