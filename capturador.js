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
    console.log("🚀 [BOJA] Capturador completo: ordinarios + extraordinarios + complementarios...");

    const urlBase = "https://www.juntadeandalucia.es";
    const documentosProcesados = [];

    // ============================================================
    // 1. FECHA ACTUAL
    // ============================================================

    const hoy = new Date();

    const yyyy = hoy.getFullYear();
    const mm = String(hoy.getMonth() + 1).padStart(2, "0");
    const dd = String(hoy.getDate()).padStart(2, "0");

    const fechaHoy = `${yyyy}${mm}${dd}`;

    console.log(`📅 Fecha de búsqueda: ${fechaHoy}`);

    // ============================================================
    // 2. BUSCAR TODOS LOS BOLETINES PUBLICADOS HOY
    //
    // Esta página puede contener:
    // - BOJA ordinario
    // - BOJA extraordinario
    // - BOJA complementario
    // - varios boletines extraordinarios el mismo día
    //
    // NO asumimos que el número sea 153, 154, 512, etc.
    // ============================================================

    const urlBoletinesDia = `${urlBase}/eboja/${fechaHoy}.html`;

    console.log(`🔎 Consultando boletines del día: ${urlBoletinesDia}`);

    let htmlDia = "";

    try {
        const respuestaDia = await fetch(urlBoletinesDia, {
            headers: {
                "User-Agent": USER_AGENT
            },
            signal: AbortSignal.timeout(20000)
        });

        console.log(`📡 HTTP página de boletines: ${respuestaDia.status}`);

        if (!respuestaDia.ok) {
            console.log(
                `⚠️ No se pudo consultar la página de boletines del día. HTTP ${respuestaDia.status}`
            );
            return [];
        }

        htmlDia = await respuestaDia.text();

    } catch (error) {
        console.error(
            "❌ Error consultando los boletines del día:",
            error.message
        );
        return [];
    }

    if (!htmlDia || htmlDia.length < 100) {
        console.log("⚠️ La página de boletines del día está vacía.");
        return [];
    }

    const $dia = cheerio.load(htmlDia);

    // ============================================================
    // 3. DETECTAR AUTOMÁTICAMENTE TODOS LOS BOLETINES
    // ============================================================

    const boletinesDetectados = new Map();

    $dia("a").each((_, el) => {

        const href = ($dia(el).attr("href") || "").trim();
        const texto = $dia(el).text().replace(/\s+/g, " ").trim();

        if (!href) return;

        // Buscamos enlaces que apunten a:
        //
        // /boja/2026/153/
        // /boja/2026/512/
        // /boja/2026/210202/
        //
        // También admitimos enlaces absolutos.

        const urlCompleta = href.startsWith("http")
            ? href
            : href.startsWith("/")
                ? urlBase + href
                : `${urlBase}/eboja/${href}`;

        const match = urlCompleta.match(
            /\/(?:boja|eboja)\/(\d{4})\/(\d{2,8})(?:\/|$)/i
        );

        if (!match) return;

        const anio = match[1];
        const numero = match[2];

        if (anio !== String(yyyy)) return;

        // Ignoramos enlaces que no parezcan boletines reales.
        // Nos interesan especialmente enlaces que contengan:
        // - boletín
        // - extraordinario
        // - complementario
        // - o rutas /boja/YYYY/numero/

        const textoLower = texto.toLowerCase();

        const pareceBoletin =
            textoLower.includes("boletín") ||
            textoLower.includes("boletin") ||
            textoLower.includes("extraordinario") ||
            textoLower.includes("complementario") ||
            /\/boja\/\d{4}\/\d{2,8}\//i.test(urlCompleta);

        if (!pareceBoletin) return;

        // Base del boletín.
        //
        // Ejemplos:
        // https://www.juntadeandalucia.es/boja/2026/153/
        // https://www.juntadeandalucia.es/boja/2026/512/
        // https://www.juntadeandalucia.es/boja/2026/210202/

        const baseBoletin =
            `${urlBase}/boja/${anio}/${numero}/`;

        boletinesDetectados.set(baseBoletin, {
            anio,
            numero,
            url: baseBoletin,
            texto
        });
    });

    // ============================================================
    // 4. SEGUNDA COMPROBACIÓN:
    // SI LA PÁGINA DEL DÍA TIENE ENLACES DIRECTOS A /eboja/
    // LOS DETECTAMOS TAMBIÉN.
    // ============================================================

    $dia("a").each((_, el) => {

        const href = ($dia(el).attr("href") || "").trim();

        if (!href) return;

        const urlCompleta = href.startsWith("http")
            ? href
            : href.startsWith("/")
                ? urlBase + href
                : `${urlBase}/eboja/${href}`;

        const match = urlCompleta.match(
            /\/(?:boja|eboja)\/(\d{4})\/(\d{2,8})(?:\/|$)/i
        );

        if (!match) return;

        const anio = match[1];
        const numero = match[2];

        if (anio !== String(yyyy)) return;

        const baseBoletin =
            `${urlBase}/boja/${anio}/${numero}/`;

        boletinesDetectados.set(baseBoletin, {
            anio,
            numero,
            url: baseBoletin,
            texto: $dia(el).text().replace(/\s+/g, " ").trim()
        });
    });

    const boletines = Array.from(boletinesDetectados.values());

    console.log("======================================");
    console.log(`📚 BOLETINES DETECTADOS HOY: ${boletines.length}`);
    console.log("======================================");

    if (boletines.length === 0) {
        console.log("ℹ️ No se han detectado boletines publicados hoy.");
        return [];
    }

    boletines.forEach((boletin, index) => {
        console.log(
            `📖 ${index + 1}. BOJA ${boletin.numero} → ${boletin.url}`
        );
    });

    // ============================================================
    // 5. SECCIONES OFICIALES DEL BOJA
    //
    // NO usamos s58/s59 porque la estructura oficial actual llega
    // hasta 5.2, representada aquí por s57.
    //
    // Si alguna sección no existe en un boletín concreto,
    // simplemente se ignora.
    // ============================================================

    const secciones = [
        "s51.html", // 1. Disposiciones generales
        "s52.html", // 2.1 Nombramientos, situaciones e incidencias
        "s53.html", // 2.2 Oposiciones, concursos y convocatorias
        "s54.html", // 3. Otras disposiciones
        "s55.html", // 4. Administración de justicia
        "s56.html", // 5.1 Licitaciones públicas y adjudicaciones
        "s57.html"  // 5.2 Otros anuncios oficiales
    ];

    // ============================================================
    // 6. PROCESAR CADA BOLETÍN
    // ============================================================

    for (const boletin of boletines) {

        console.log("");
        console.log("======================================");
        console.log(
            `📖 PROCESANDO BOJA ${boletin.numero}`
        );
        console.log(
            `🔗 ${boletin.url}`
        );
        console.log("======================================");

        for (const seccion of secciones) {

            const urlSeccion = boletin.url + seccion;

            try {

                console.log(`📑 Comprobando ${seccion}: ${urlSeccion}`);

                const respuesta = await fetch(urlSeccion, {
                    headers: {
                        "User-Agent": USER_AGENT
                    },
                    signal: AbortSignal.timeout(15000)
                });

                if (!respuesta.ok) {
                    console.log(
                        `↪️ ${seccion} no disponible (HTTP ${respuesta.status})`
                    );
                    continue;
                }

                const html = await respuesta.text();

                if (!html || html.length < 100) {
                    console.log(
                        `↪️ ${seccion} está vacía`
                    );
                    continue;
                }

                const $ = cheerio.load(html);

                console.log(
                    `✅ ${seccion} disponible`
                );

                // ====================================================
                // 7. BUSCAR TODOS LOS PDF OFICIALES
                // ====================================================

                $("a").each((_, linkEl) => {

                    let hrefPdf = ($(linkEl).attr("href") || "").trim();

                    if (!hrefPdf) return;

                    const hrefLower = hrefPdf.toLowerCase();

                    // Solo PDF
                    if (!hrefLower.includes(".pdf")) return;

                    // Evitar sumarios y verificaciones
                    if (hrefLower.includes("sumario")) return;
                    if (hrefLower.includes("verificacion")) return;
                    if (hrefLower.includes("verificación")) return;

                    // =================================================
                    // CONSTRUIR URL ABSOLUTA
                    // =================================================

                    let urlPdfFinal = "";

                    if (hrefPdf.startsWith("http://") ||
                        hrefPdf.startsWith("https://")) {

                        urlPdfFinal = hrefPdf;

                    } else if (hrefPdf.startsWith("/")) {

                        urlPdfFinal = urlBase + hrefPdf;

                    } else {

                        urlPdfFinal = boletin.url + hrefPdf;
                    }

                    // =================================================
                    // OBTENER TÍTULO DEL ANUNCIO
                    // =================================================

                    const $contenedor = $(linkEl).closest(
                        "p, li, div.disposicion, tr, article"
                    );

                    const $clon = $contenedor.clone();

                    $clon.find("a, script, style").remove();

                    let tituloAnuncio = $clon
                        .text()
                        .replace(/\s+/g, " ")
                        .trim();

                    // Si el contenedor no contiene suficiente texto,
                    // utilizamos el texto del propio enlace.

                    if (tituloAnuncio.length < 25) {

                        tituloAnuncio = $(linkEl)
                            .text()
                            .replace(/\s+/g, " ")
                            .trim();
                    }

                    // =================================================
                    // LIMPIEZA DEL TÍTULO
                    // =================================================

                    tituloAnuncio = tituloAnuncio
                        .replace(/PDF oficial auténtico/gi, "")
                        .replace(/Otros formatos/gi, "")
                        .replace(/Verificar autenticidad/gi, "")
                        .replace(/texto núm\..*$/gi, "")
                        .replace(/páginas?.*$/gi, "")
                        .replace(/\s+/g, " ")
                        .trim();

                    // =================================================
                    // VALIDAR TÍTULO
                    // =================================================

                    if (
                        tituloAnuncio.length > 20 &&
                        !tituloAnuncio.toLowerCase().startsWith("sumario")
                    ) {

                        console.log(
                            `📄 PDF encontrado: ${urlPdfFinal}`
                        );

                        evaluarYGuardar(
                            tituloAnuncio,
                            urlPdfFinal,
                            "JUNTA DE ANDALUCÍA",
                            documentosProcesados
                        );
                    }
                });

            } catch (error) {

                // Es normal que un boletín no tenga alguna sección.
                console.log(
                    `↪️ ${seccion} omitida: ${error.message}`
                );
            }
        }
    }

    // ============================================================
    // 8. ELIMINAR DUPLICADOS
    // ============================================================

    const unicos = Array.from(
        new Map(
            documentosProcesados.map(d => [d.url_pdf, d])
        ).values()
    );

    console.log("");
    console.log("======================================");
    console.log(
        `🎯 ANUNCIOS RELEVANTES ENCONTRADOS: ${unicos.length}`
    );
    console.log("======================================");

    // ============================================================
    // 9. GUARDAR EN SUPABASE
    // ============================================================

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

    console.log("");
    console.log("======================================");
    console.log("🏁 CAPTURADOR BOJA FINALIZADO");
    console.log("======================================");

    return unicos;
}

async function probarRSSBOJA() {

    const url =
        "https://www.juntadeandalucia.es/boja/distribucion/s51.xml";

    console.log("📡 Probando RSS oficial del BOJA:");
    console.log(url);

    try {

        const res = await fetch(url, {
            headers: {
                "User-Agent": USER_AGENT
            },
            signal: AbortSignal.timeout(20000)
        });

        console.log("📡 HTTP:", res.status);
        console.log("📡 OK:", res.ok);

        const xml = await res.text();

        console.log("📄 Longitud XML:", xml.length);
        console.log("📋 Primeros 5000 caracteres:");
        console.log(xml.substring(0, 5000));

        return xml;

    } catch (error) {

        console.error(
            "❌ ERROR RSS:",
            error.message
        );

        return null;
    }
}

export { ejecutarCapturadorBoja as ejecutarBOJA };
