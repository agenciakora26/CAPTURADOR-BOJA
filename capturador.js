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
  console.log("🚀 Extrayendo anuncios del BOJA directamente desde los índices de los boletines...");

  const urlBase = "https://www.juntadeandalucia.es";
  
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm = String(hoy.getMonth() + 1).padStart(2, '0');
  const dd = String(hoy.getDate()).padStart(2, '0');
  const fechaFormateada = `${yyyy}${mm}${dd}`;
  
  const urlDia = `${urlBase}/eboja/${fechaFormateada}.html`;
  console.log(`🔗 Accediendo a la página del día: ${urlDia}`);

  let htmlDia = "";
  try {
    const resDia = await fetch(urlDia, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000)
    });

    if (!resDia.ok) {
      console.log(`⚠️ No se encontró la página del día ${fechaFormateada}`);
      return [];
    }
    htmlDia = await resDia.text();
  } catch (error) {
    console.error("❌ Excepción al conectar con la página del día:", error.message);
    return [];
  }

  // 1. Detectar las URLs exactas de los boletines activos de hoy
  const $dia = cheerio.load(htmlDia);
  const urlsIndicesBoletines = new Set();

  $dia("a").each((_, el) => {
    let href = $dia(el).attr("href") || "";
    let texto = $dia(el).text().toLowerCase();

    if (href && !href.endsWith(".pdf") && (href.includes(`/${yyyy}/`) || texto.includes("boletín"))) {
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
      
      if (!urlAbsoluta.endsWith("index.html") && !urlAbsoluta.endsWith(".html")) {
        urlAbsoluta = urlAbsoluta.endsWith("/") ? `${urlAbsoluta}index.html` : `${urlAbsoluta}/index.html`;
      }

      urlsIndicesBoletines.add(urlAbsoluta);
    }
  });

  const listaIndices = Array.from(urlsIndicesBoletines).filter(u => !u.endsWith("/BOJA/index.html"));
  console.log(`📌 Índices de boletines detectados para hoy:`, listaIndices);

  const documentosProcesados = [];

  // 2. Por cada boletín, leemos su índice principal y todas las secciones del menú lateral (s51, s52, s53, s55)
  for (const urlIndice of listaIndices) {
    try {
      console.log(`🔗 Leyendo boletín: ${urlIndice}`);
      
      // Derivamos las URLs estándar de las secciones a partir de la URL del boletín (ej: .../2026/153/)
      const baseUrlBoletin = urlIndice.substring(0, urlIndice.lastIndexOf("/") + 1);
      const paginasAEvaluar = [
        urlIndice,
        `${baseUrlBoletin}s51.html`, // Disposiciones generales
        `${baseUrlBoletin}s52.html`, // Autoridades y personal
        `${baseUrlBoletin}s53.html`, // Otras disposiciones
        `${baseUrlBoletin}s55.html`  // Anuncios
      ];

      for (const urlPagina of paginasAEvaluar) {
        try {
          const resPag = await fetch(urlPagina, {
            headers: { "User-Agent": USER_AGENT },
            signal: AbortSignal.timeout(10000)
          });
          if (!resPag.ok) continue;

          const htmlPag = await resPag.text();
          const $ = cheerio.load(htmlPag);

          // Buscamos los enlaces a los PDF oficiales
          $("a[href*='.pdf']").each((_, el) => {
            let hrefPdf = $(el).attr("href") || "";
            if (hrefPdf.toLowerCase().includes("sumario") || hrefPdf.toLowerCase().includes("verificacion")) return;

            let urlPdfFinal = hrefPdf.startsWith("http") ? hrefPdf : urlBase + (hrefPdf.startsWith("/") ? hrefPdf : "/" + hrefPdf);
            
            // Extraemos el texto del bloque contenedor de la disposición
            const $contenedor = $(el).closest("p, li, div.disposicion, tr, article");
            const $clon = $contenedor.clone();
            $clon.find("a, script, style").remove();
            
            let tituloAnuncio = $clon.text().replace(/\s+/g, " ").trim();

            if (tituloAnuncio.length < 25) {
              tituloAnuncio = $(el).text().replace(/\s+/g, " ").trim();
            }

            tituloAnuncio = tituloAnuncio
              .replace(/PDF oficial auténtico/gi, "")
              .replace(/Otros formatos/gi, "")
              .replace(/Verificar autenticidad/gi, "")
              .replace(/texto núm\..*$/gi, "")
              .replace(/páginas?.*$/gi, "")
              .trim();

            if (tituloAnuncio.length > 20 && !tituloAnuncio.toLowerCase().startsWith("sumario")) {
              evaluarYGuardar(tituloAnuncio, urlPdfFinal, "JUNTA DE ANDALUCÍA", documentosProcesados);
            }
          });

        } catch (subErr) {
          // Sección no disponible en este boletín, pasamos a la siguiente
        }
      }

    } catch (err) {
      console.log(`⚠️ Error al procesar boletín ${urlIndice}: ${err.message}`);
    }
  }

  // Deduplicación estricta por URL del PDF
  const unicos = Array.from(new Map(documentosProcesados.map(d => [d.url_pdf, d])).values());
  console.log(`🎯 Anuncios relevantes capturados en el BOJA de hoy: ${unicos.length}`);

  // 3. Guardado en Supabase
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
