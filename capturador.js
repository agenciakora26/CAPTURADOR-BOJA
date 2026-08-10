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
    console.log("🚀 [BOJA] Capturador mediante RSS oficial...");

    const RSS_BOJA = [
        {
            nombre: "Disposiciones generales",
            url: "https://www.juntadeandalucia.es/boja/distribucion/s51.xml"
        }
    ];

    const documentosProcesados = [];

    // ==========================================================
    // FUNCIÓN: Obtener el PDF desde la página HTML de la disposición
    // ==========================================================
    async function obtenerPDFDesdePublicacion(urlPublicacion) {
        try {
            console.log(`🌐 Abriendo publicación BOJA: ${urlPublicacion}`);

            const respuesta = await fetch(urlPublicacion, {
                headers: {
                    "User-Agent": USER_AGENT
                },
                signal: AbortSignal.timeout(20000)
            });

            console.log(`📡 HTTP publicación: ${respuesta.status}`);

            if (!respuesta.ok) {
                console.log(
                    `⚠️ No se pudo abrir la publicación: ${respuesta.status}`
                );
                return null;
            }

            const html = await respuesta.text();

            if (!html || html.length < 100) {
                console.log("⚠️ La página de publicación está vacía");
                return null;
            }

            const $ = cheerio.load(html);

            let urlPDF = null;

            // --------------------------------------------------
            // Buscar enlaces PDF directamente
            // --------------------------------------------------
            $("a").each((_, el) => {
                if (urlPDF) return;

                const href = $(el).attr("href") || "";
                const texto = $(el).text().toLowerCase().trim();

                if (!href) return;

                const hrefLower = href.toLowerCase();

                // PDF directo
                if (
                    hrefLower.includes(".pdf") &&
                    !hrefLower.includes("sumario") &&
                    !hrefLower.includes("verificacion")
                ) {
                    urlPDF = href;
                    console.log(`📄 PDF encontrado por href: ${href}`);
                    return;
                }

                // Enlace cuyo texto indica que es el PDF
                if (
                    texto.includes("descargar la disposición en pdf") ||
                    texto.includes("descargar disposición en pdf") ||
                    texto.includes("disposición en pdf") ||
                    texto.includes("pdf oficial")
                ) {
                    urlPDF = href;
                    console.log(`📄 PDF encontrado por texto: ${href}`);
                }
            });

            // --------------------------------------------------
            // Si encontramos PDF, convertirlo en URL absoluta
            // --------------------------------------------------
            if (urlPDF) {
                const urlAbsoluta = new URL(
                    urlPDF,
                    urlPublicacion
                ).href;

                console.log(`✅ URL PDF definitiva: ${urlAbsoluta}`);

                return urlAbsoluta;
            }

            console.log(
                "❌ No se encontró ningún PDF en la página de la disposición"
            );

            return null;

        } catch (error) {
            console.error(
                `❌ Error obteniendo PDF desde ${urlPublicacion}:`,
                error.message
            );

            return null;
        }
    }

    // ==========================================================
    // LEER LOS RSS OFICIALES
    // ==========================================================

    for (const fuente of RSS_BOJA) {
        try {
            console.log(`📡 Leyendo RSS: ${fuente.nombre}`);
            console.log(`🔗 ${fuente.url}`);

            const respuesta = await fetch(fuente.url, {
                headers: {
                    "User-Agent": USER_AGENT
                },
                signal: AbortSignal.timeout(20000)
            });

            console.log(`📡 Respuesta HTTP: ${respuesta.status}`);

            if (!respuesta.ok) {
                console.log(
                    `⚠️ RSS ${fuente.nombre} respondió HTTP ${respuesta.status}`
                );
                continue;
            }

            const xml = await respuesta.text();

            console.log(
                `📄 Longitud del XML: ${xml.length} caracteres`
            );

            if (!xml || xml.length < 50) {
                console.log(
                    `⚠️ El RSS ${fuente.nombre} está vacío`
                );
                continue;
            }

            const $rss = cheerio.load(xml, {
                xmlMode: true
            });

            // ==================================================
            // IMPORTANTE:
            // El BOJA utiliza ATOM, por lo que buscamos "entry"
            // y NO "item".
            // ==================================================

            const entradas = $rss("entry");

            console.log(
                `📚 ${fuente.nombre}: ${entradas.length} publicaciones encontradas`
            );

            // ==================================================
            // PROCESAR CADA PUBLICACIÓN
            // ==================================================

            for (let i = 0; i < entradas.length; i++) {

                const entry = entradas[i];
                const $entry = $rss(entry);

                const titulo = $entry
                    .find("title")
                    .first()
                    .text()
                    .trim();

                const descripcion = $entry
                    .find("content")
                    .first()
                    .text()
                    .trim();

                const fecha = $entry
                    .find("updated")
                    .first()
                    .text()
                    .trim();

                // --------------------------------------------------
                // En Atom el enlace está normalmente en:
                // <link href="...">
                // --------------------------------------------------

                let enlace = "";

                $entry.find("link").each((_, linkEl) => {
                    if (enlace) return;

                    const href = $rss(linkEl).attr("href") || "";

                    if (
                        href &&
                        !href.includes("distribucions51.xml")
                    ) {
                        enlace = href;
                    }
                });

                if (!titulo || !enlace) {
                    console.log(
                        "⚠️ Publicación ignorada: falta título o enlace"
                    );
                    continue;
                }

                console.log("----------------------------------------");
                console.log(`📰 Título: ${titulo}`);
                console.log(`🔗 Publicación: ${enlace}`);
                console.log(`📅 Fecha: ${fecha}`);

                // --------------------------------------------------
                // Buscar el PDF dentro de la página de la publicación
                // --------------------------------------------------

                const urlPDF = await obtenerPDFDesdePublicacion(
                    enlace
                );

                if (!urlPDF) {
                    console.log(
                        "⚠️ No se encontró PDF para esta publicación"
                    );
                    continue;
                }

                console.log(`📄 PDF oficial: ${urlPDF}`);

                // --------------------------------------------------
                // Clasificar y guardar
                // --------------------------------------------------

                evaluarYGuardar(
                    titulo,
                    urlPDF,
                    "JUNTA DE ANDALUCÍA",
                    documentosProcesados
                );
            }

        } catch (error) {
            console.error(
                `❌ Error leyendo RSS ${fuente.nombre}:`,
                error.message
            );
        }
    }

    // ==========================================================
    // ELIMINAR DUPLICADOS
    // ==========================================================

    const unicos = Array.from(
        new Map(
            documentosProcesados.map(d => [
                d.url_pdf,
                d
            ])
        ).values()
    );

    console.log("======================================");
    console.log(
        `🎯 Anuncios relevantes encontrados: ${unicos.length}`
    );
    console.log("======================================");

    // ==========================================================
    // GUARDAR EN SUPABASE
    // ==========================================================

    for (const d of unicos) {
        try {

            await supabaseRequest(
                "anuncios_boja?on_conflict=url_pdf",
                {
                    method: "POST",

                    headers: {
                        Prefer: "resolution=merge-duplicates"
                    },

                    body: JSON.stringify({
                        titulo: d.titulo,
                        url_pdf: d.url_pdf,
                        categoria: d.sector,
                        origen: "BOJA"
                    })
                }
            );

            console.log(
                `✅ Guardado en Supabase: ${d.titulo}`
            );

        } catch (err) {

            console.log(
                `⚠️ Aviso al guardar en Supabase: ${err.message}`
            );
        }
    }

    return unicos;
}


// ==========================================================
// FUNCIÓN DE PRUEBA DEL RSS
// ==========================================================

async function probarRSSBOJA() {

    const url =
        "https://www.juntadeandalucia.es/boja/distribucion/s51.xml";

    console.log(
        "📡 Probando RSS oficial del BOJA:"
    );

    console.log(url);

    try {

        const res = await fetch(url, {
            headers: {
                "User-Agent": USER_AGENT
            },

            signal: AbortSignal.timeout(20000)
        });

        console.log(
            "📡 HTTP:",
            res.status
        );

        console.log(
            "📡 OK:",
            res.ok
        );

        const xml = await res.text();

        console.log(
            "📄 Longitud XML:",
            xml.length
        );

        console.log(
            "📋 Primeros 5000 caracteres:"
        );

        console.log(
            xml.substring(0, 5000)
        );

        return xml;

    } catch (error) {

        console.error(
            "❌ ERROR RSS:",
            error.message
        );

        return null;
    }
}


// ==========================================================
// EXPORTACIÓN
// ==========================================================

export {
    ejecutarCapturadorBoja as ejecutarBOJA
};
