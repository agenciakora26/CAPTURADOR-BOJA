const cheerio = require("cheerio");
const pdfParse = require("pdf-parse");
const pLimit = require("p-limit");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "")
  .replace(/\/rest\/v1\/?$/i, "")
  .replace(/\/+$/, "");

const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const BASE_BOJA = "https://www.juntadeandalucia.es/eboja";
const BASE_API_BOJA = "https://datos.juntadeandalucia.es/api/v0/boja";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0; +https://boletinhoy.es)";
const MAX_PDF_BYTES = 35 * 1024 * 1024;

const DRY_RUN = process.env.DRY_RUN === "true";
const TARGET_DATE = process.env.TARGET_DATE || null;

if (!SUPABASE_URL || !SUPABASE_KEY || !RESEND_API_KEY) {
  console.error("❌ Faltan SUPABASE_URL, SUPABASE_KEY o RESEND_API_KEY.");
  process.exit(1);
}

// Caché en memoria para evitar peticiones repetidas en ejecuciones consecutivas breves
const memoryCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

async function fetchCached(url, accept = "*/*", intentos = 3) {
  const ahora = Date.now();
  if (memoryCache.has(url)) {
    const cached = memoryCache.get(url);
    if (ahora - cached.timestamp < CACHE_TTL_MS) {
      return cached.response.clone();
    }
  }

  const respuesta = await descargar(url, accept, intentos);
  memoryCache.set(url, { timestamp: ahora, response: respuesta.clone() });
  return respuesta;
}

const SECTORES = {
  "oposiciones y empleo público": {
    palabras: {
      "oposicion / oposiciones": 3, "concurso-oposicion": 3, "concurso oposicion": 3,
      "proceso selectivo / procesos selectivos": 3, "pruebas selectivas": 3,
      "empleo publico": 3, "oferta de empleo publico": 3, "bolsa de empleo": 2,
      "bolsa de trabajo": 2, "turno libre": 2, "acceso libre": 2, "plazas vacantes": 2,
      "personal funcionario": 2, "personal laboral": 2, "personal estatutario": 2,
      "funcionario de carrera": 3, "nombramiento": 2, "toma de posesion": 2
    },
    umbral: 4
  },
  "subvenciones y ayudas": {
    palabras: {
      "subvencion / subvenciones": 3, "bases reguladoras": 3,
      "concesion de subvenciones": 3, "ayudas directas": 3, "incentivo / incentivos": 2,
      "concurrencia competitiva": 3, "concurrencia no competitiva": 3,
      "extracto de la resolucion": 3, "plazo de solicitud": 2,
      "personas trabajadoras autonomas": 3
    },
    umbral: 4
  },
  "agricultura y pesca": {
    palabras: {
      "agricultura": 3, "agricola": 2, "pesca": 3, "pesquero / pesquera": 2,
      "ganaderia": 3, "ganadero / ganadera": 2, "politica agraria comun": 3,
      "explotacion agraria / explotaciones agrarias": 3, "desarrollo rural": 2,
      "sector agrario": 2, "sector pesquero": 2, "acuicultura": 3
    },
    umbral: 4
  },
  "hostelería y comercio": {
    palabras: {
      "hosteleria": 3, "hostelero / hostelera": 2, "comercio": 2, "turismo": 3,
      "turistico / turistica": 2, "restauracion": 2, "establecimientos turisticos": 3,
      "alojamientos turisticos": 3, "hoteles": 2, "agencias de viajes": 2,
      "comercio interior": 2, "artesania": 2, "mercados de abastos": 2
    },
    umbral: 4
  },
  "licitaciones y contratación": {
    palabras: {
      "licitacion / licitaciones": 3, "contratacion publica": 3, "contrato publico": 3,
      "contrato menor": 2, "mesa de contratacion": 3, "pliego de clausulas administrativas": 3,
      "adjudicacion / adjudicaciones": 2, "formalizacion de contrato": 3,
      "procedimiento abierto": 2, "acuerdo marco": 2, "obras publicas": 2, "concurso publico": 3
    },
    umbral: 4
  },
  "sanidad y servicios sociales": {
    palabras: {
      "servicio andaluz de salud": 4, "personal estatutario": 2, "sanidad": 3,
      "hospital / hospitalario": 2, "enfermeria": 3, "enfermero / enfermera": 2,
      "medicina": 2, "medico / medica": 2, "atencion primaria": 3,
      "servicios sociales": 3, "dependencia": 2
    },
    umbral: 4
  },
  "educación y universidades": {
    palabras: {
      "educacion": 3, "universidad / universidades": 3, "personal docente": 3,
      "profesorado": 3, "maestro / maestra": 2, "beca / becas": 2,
      "centros educativos": 2, "formacion profesional": 3, "cuerpos docentes universitarios": 3
    },
    umbral: 4
  },
  "medio ambiente y sostenibilidad": {
    palabras: {
      "medio ambiente": 3, "medioambiental": 3, "sostenibilidad": 3, "impacto ambiental": 3,
      "evaluacion ambiental": 3, "residuos": 2, "energias renovables": 3,
      "energia solar": 2, "proteccion ambiental": 2, "calidad ambiental": 2
    },
    umbral: 4
  }
};

function normalizar(valor = "") {
  return String(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”«»"'’]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function escaparHtml(valor = "") {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizarUrlPdf(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function normalizarUrlPagina(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function urlAbsoluta(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

async function descargar(url, accept = "*/*", intentos = 3) {
  let ultimoError;
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const respuesta = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(25000),
        headers: {
          "User-Agent": USER_AGENT,
          Accept: accept,
          "Accept-Language": "es-ES,es;q=0.9"
        }
      });

      if (respuesta.status === 404) {
        throw new Error(`HTTP 404 al consultar ${url}`);
      }

      if (!respuesta.ok) {
        if ([429, 500, 502, 503, 504].includes(respuesta.status) && intento < intentos) {
          const espera = Math.pow(2, intento) * 1000;
          await new Promise(res => setTimeout(res, espera));
          continue;
        }
        throw new Error(`HTTP ${respuesta.status} al consultar ${url}`);
      }

      return respuesta;
    } catch (error) {
      ultimoError = error;
      if (error.message.includes("404")) {
        throw error;
      }
      if (intento < intentos) {
        const espera = Math.pow(2, intento) * 1000;
        await new Promise(res => setTimeout(res, espera));
        continue;
      }
    }
  }
  throw ultimoError;
}

function obtenerFechasRevision() {
  const fechas = [];
  const baseDate = TARGET_DATE ? new Date(`${TARGET_DATE}T12:00:00`) : new Date();

  for (let i = 0; i < 2; i++) {
    const d = new Date(baseDate.getTime() - (i * 24 * 60 * 60 * 1000));
    const formatter = new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const partes = formatter.formatToParts(d);
    const anio = partes.find(p => p.type === "year").value;
    const mes = partes.find(p => p.type === "month").value;
    const dia = partes.find(p => p.type === "day").value;

    fechas.push({
      anio,
      mes,
      dia,
      fechaIso: `${anio}-${mes}-${dia}`,
      formatoFecha: `${anio}${mes}${dia}`
    });
  }
  console.log(`📅 Fechas revisadas (Europe/Madrid):`, fechas.map(f => f.formatoFecha));
  return fechas;
}

function extraerDatosPublicacion(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "www.juntadeandalucia.es") {
      return null;
    }
    const pathname = parsed.pathname
      .replace(/\/index\.html$/i, "/")
      .replace(/\/+$/, "/");

    const match = pathname.match(/^\/eboja\/(\d{4})\/(\d+)\/(?:(c\d{2,3})\/)?$/i);
    if (!match) {
      return null;
    }

    return {
      source: "url",
      year: parseInt(match[1], 10),
      number: match[2],
      complement: match[3]?.toLowerCase() || null,
      publicationUrl: `${parsed.protocol}//${parsed.host}${pathname}`
    };
  } catch {
    return null;
  }
}

// 1. Parser alineado con OpenAPI / estructura real de la API de datos de la Junta
async function obtenerPublicacionesDesdeApi(fechas) {
  const publicaciones = [];
  for (const f of fechas) {
    let page = 0;
    const size = 100;
    let hayMas = true;
    let seguridad = 0;

    while (hayMas && seguridad < 10) {
      seguridad++;
      const urlApi = `${BASE_API_BOJA}/get/search_pagination?order_by=date&mode=DESC&size=${size}&page=${page}&date_from=${f.fechaIso}&date_to=${f.fechaIso}`;
      try {
        const resp = await fetchCached(urlApi, "application/json");
        const json = await resp.json();
        
        let items = [];
        // Adaptabilidad estricta al esquema real devuelto por la API
        if (Array.isArray(json)) {
          items = json;
        } else if (json && Array.isArray(json.results)) {
          items = json.results;
        } else if (json && Array.isArray(json.items)) {
          items = json.items;
        } else if (json && Array.isArray(json.data)) {
          items = json.data;
        } else if (json && json.response && Array.isArray(json.response.docs)) {
          items = json.response.docs;
        }

        if (items.length === 0) {
          hayMas = false;
          break;
        }

        for (const item of items) {
          const urlDisp = item.url || item.enlace || item.link || item.uri || null;
          const urlPdf = item.url_pdf || item.pdf || item.documentoPdf || item.enlacePdf || null;
          const datosUrl = urlDisp ? extraerDatosPublicacion(urlDisp) : null;

          publicaciones.push({
            source: "api",
            year: datosUrl?.year || parseInt(f.anio, 10),
            number: datosUrl?.number || item.numero || f.formatoFecha,
            complement: datosUrl?.complement || item.complemento || null,
            publicationDate: f.fechaIso,
            publicationUrl: datosUrl?.publicationUrl || urlDisp || `${BASE_BOJA}/${f.formatoFecha}.html`,
            dispositionUrl: urlDisp,
            pdfUrl: urlPdf ? normalizarUrlPdf(urlPdf) : null,
            title: item.titulo || item.title || item.asunto || "Documento publicado en el BOJA",
            summary: item.resumen || item.summary || "",
            organisation: item.organismo || item.organisation || "",
            section: item.seccion || item.section || "",
            officialId: item.id || item.codigo || item.guid || null
          });
        }

        if (items.length < size) {
          hayMas = false;
        } else {
          page++;
        }
      } catch (error) {
        console.log(`   ⚠️ API no disponible para la fecha ${f.fechaIso}: ${error.message}`);
        hayMas = false;
      }
    }
  }
  console.log(`   ✅ API oficial: ${publicaciones.length} registros obtenidos.`);
  return publicaciones;
}

// 2. Extracción elegante y robusta desde la Portada oficial
async function obtenerPublicacionesDesdePortada(fechas) {
  const publicaciones = [];
  try {
    const resp = await fetchCached(`${BASE_BOJA}.html`, "text/html");
    const html = await resp.text();
    const $ = cheerio.load(html);

    let enlacePortadaEncontrado = null;

    // Buscar "Último BOJA" o la ruta estructurada recomendada
    $("a").each((_, el) => {
      const textoEnlace = $(el).text();
      const href = $(el).attr("href");
      if (/ultimo boja|acceder al ultimo boja/i.test(textoEnlace) && href) {
        const abs = urlAbsoluta(href, BASE_BOJA);
        if (abs) {
          enlacePortadaEncontrado = abs;
          return false; // romper bucle
        }
      }
    });

    if (enlacePortadaEncontrado) {
      const datos = extraerDatosPublicacion(enlacePortadaEncontrado);
      if (datos) {
        publicaciones.push({
          source: "portada",
          year: datos.year,
          number: datos.number,
          complement: datos.complement,
          publicationDate: `${datos.year}-01-01`,
          publicationUrl: datos.publicationUrl,
          dispositionUrl: null,
          pdfUrl: null,
          title: "Último BOJA desde Portada",
          summary: "",
          organisation: "",
          section: "",
          officialId: null
        });
      }
    }

    // Fallback elegante si no encuentra el texto exacto pero sigue la estructura habitual de la home
    if (publicaciones.length === 0) {
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        const abs = urlAbsoluta(href, BASE_BOJA);
        if (!abs) return;

        const datos = extraerDatosPublicacion(abs);
        if (datos) {
          const coincideFecha = fechas.some(f => String(datos.year) === f.anio);
          if (coincideFecha) {
            publicaciones.push({
              source: "portada",
              year: datos.year,
              number: datos.number,
              complement: datos.complement,
              publicationDate: `${datos.year}-01-01`,
              publicationUrl: datos.publicationUrl,
              dispositionUrl: null,
              pdfUrl: null,
              title: $(el).text().trim() || "Último BOJA desde Portada",
              summary: "",
              organisation: "",
              section: "",
              officialId: null
            });
          }
        }
      });
    }
  } catch (error) {
    console.log(`   ⚠️ Portada no disponible: ${error.message}`);
  }
  console.log(`   ✅ Portada oficial: ${publicaciones.length} referencias detectadas.`);
  return publicaciones;
}

// 9. Cuarta fuente opcional: RSS oficial de la Junta de Andalucía
async function obtenerPublicacionesDesdeRss(fechas) {
  const publicaciones = [];
  const urlsRss = [
    `${BASE_BOJA}/rss.xml`,
    `${BASE_BOJA}/noticias.rss`,
    "https://www.juntadeandalucia.es/eboja/rss"
  ];

  for (const urlRss of urlsRss) {
    try {
      const resp = await fetchCached(urlRss, "application/rss+xml, text/xml, */*");
      const xml = await resp.text();
      const $ = cheerio.load(xml, { xmlMode: true });

      $("item").each((_, el) => {
        const titulo = $(el).find("title").text();
        const link = $(el).find("link").text();
        const descripcion = $(el).find("description").text();
        const pubDateStr = $(el).find("pubDate").text();

        const abs = urlAbsoluta(link, BASE_BOJA);
        if (!abs) return;

        const datos = extraerDatosPublicacion(abs);
        if (datos) {
          publicaciones.push({
            source: "rss",
            year: datos.year,
            number: datos.number,
            complement: datos.complement,
            publicationDate: fechas[0].fechaIso, // Aproximación segura
            publicationUrl: datos.publicationUrl,
            dispositionUrl: abs,
            pdfUrl: null,
            title: titulo || "Documento desde RSS",
            summary: descripcion || "",
            organisation: "",
            section: "",
            officialId: null
          });
        }
      });

      if (publicaciones.length > 0) break; // Si una URL funciona, no necesitamos más
    } catch {}
  }
  console.log(`   ✅ RSS oficial (4ª fuente): ${publicaciones.length} referencias detectadas.`);
  return publicaciones;
}

async function obtenerPublicacionesDesdeIndicesDiarios(fechas) {
  const publicaciones = [];
  for (const f of fechas) {
    const urlFecha = `${BASE_BOJA}/${f.formatoFecha}.html`;
    try {
      const resp = await fetchCached(urlFecha, "text/html");
      const html = await resp.text();
      const $ = cheerio.load(html);

      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        const abs = urlAbsoluta(href, resp.url);
        if (!abs) return;

        const datos = extraerDatosPublicacion(abs);
        if (datos) {
          publicaciones.push({
            source: "indice_diario",
            year: datos.year,
            number: datos.number,
            complement: datos.complement,
            publicationDate: f.fechaIso,
            publicationUrl: datos.publicationUrl,
            dispositionUrl: abs,
            pdfUrl: /\.pdf$/i.test(abs) ? normalizarUrlPdf(abs) : null,
            title: $(el).text().trim() || "Documento en índice diario",
            summary: "",
            organisation: "",
            section: "",
            officialId: null
          });
        }
      });
      console.log(`   ✅ Índice diario encontrado: ${urlFecha}`);
    } catch {
      console.log(`   ⚠️ Índice diario no disponible: ${urlFecha}`);
    }
  }
  return publicaciones;
}

async function obtenerPaginasSecciones(publicacionUrl) {
  try {
    const resp = await fetchCached(publicacionUrl, "text/html");
    const html = await resp.text();
    const $ = cheerio.load(html);
    const paginas = new Set([publicacionUrl]);

    $("a[href]").each((_, elemento) => {
      const href = $(elemento).attr("href");
      const absoluta = urlAbsoluta(href, publicacionUrl);
      if (!absoluta || !absoluta.startsWith(publicacionUrl)) return;

      try {
        const parsedPath = new URL(absoluta).pathname;
        if (/\/s\d+\.html$/i.test(parsedPath)) {
          const limpia = normalizarUrlPagina(absoluta);
          if (limpia) paginas.add(limpia);
        }
      } catch {}
    });

    return [...paginas];
  } catch {
    return [publicacionUrl];
  }
}

function obtenerTituloCercano($, elemento) {
  const enlace = $(elemento);
  const candidatos = [
    enlace.closest("li").text(),
    enlace.closest("article").text(),
    enlace.closest(".item").text(),
    enlace.closest("div").text(),
    enlace.parent().text()
  ];

  for (const candidato of candidatos) {
    const limpio = String(candidato || "")
      .replace(/PDF oficial auténtico/gi, "")
      .replace(/Otros formatos/gi, "")
      .replace(/Verificar autenticidad/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (limpio.length >= 25) {
      return limpio.substring(0, 1000);
    }
  }

  return "Documento publicado en el BOJA";
}

// 8. Parser de PDFs inteligente (revisa extensión Y comprueba cabecera HEAD Content-Type)
async function esUrlPdfValida(urlPdfAbs) {
  if (/\.pdf(?:$|[?#])/i.test(urlPdfAbs)) return true;
  try {
    const respHead = await fetch(urlPdfAbs, { method: "HEAD", signal: AbortSignal.timeout(10000), headers: { "User-Agent": USER_AGENT } });
    const contentType = respHead.headers.get("content-type") || "";
    if (contentType.toLowerCase().includes("application/pdf")) {
      return true;
    }
  } catch {}
  return false;
}

async function obtenerDocumentosPagina(urlPagina) {
  const resp = await fetchCached(urlPagina, "text/html");
  const html = await resp.text();
  const $ = cheerio.load(html);
  const documentos = new Map();

  for (const elemento of $("a[href]").toArray()) {
    const enlace = $(elemento);
    const href = enlace.attr("href") || "";
    const textoEnlace = normalizar(enlace.text());

    const urlPdfAbs = urlAbsoluta(href, resp.url);
    if (!urlPdfAbs) continue;

    const esValido = await esUrlPdfValida(urlPdfAbs);
    if (!esValido && !textoEnlace.includes("pdf oficial autentico")) continue;

    const urlPdfNorm = normalizarUrlPdf(urlPdfAbs);
    if (!urlPdfNorm) continue;

    const contexto = normalizar(enlace.closest("li,article,div").text());
    if (contexto.includes("boletin completo") || contexto.includes("sumario boletin")) continue;

    documentos.set(urlPdfNorm, {
      urlPdf: urlPdfNorm,
      tituloPagina: obtenerTituloCercano($, enlace),
      urlSeccion: resp.url
    });
  }

  return [...documentos.values()];
}

async function extraerTextoPdf(urlPdf) {
  const respuesta = await descargar(urlPdf, "application/pdf");
  const contentType = normalizar(respuesta.headers.get("content-type") || "");

  if (contentType && !contentType.includes("application/pdf") && !contentType.includes("application/octet-stream")) {
    throw new Error(`Contenido inesperado: ${contentType}`);
  }

  const contentLength = Number(respuesta.headers.get("content-length") || 0);
  if (contentLength > MAX_PDF_BYTES) {
    throw new Error("El PDF supera los 35 MB.");
  }

  const buffer = Buffer.from(await respuesta.arrayBuffer());
  if (buffer.length > MAX_PDF_BYTES) {
    throw new Error("El PDF supera los 35 MB.");
  }

  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("El contenido descargado no es un PDF válido.");
  }

  const resultado = await pdfParse(buffer);
  return String(resultado.text || "").replace(/\u0000/g, " ");
}

function detectarSectores(texto, titulo = "") {
  const textoNormalizado = normalizar(texto);
  const tituloNormalizado = normalizar(titulo);
  const coincidencias = [];

  const escaparRegex = valor => valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const [sector, configuracion] of Object.entries(SECTORES)) {
    let puntuacionTotal = 0;
    const palabrasEncontradasSet = new Set();

    for (const [claveGrupo, peso] of Object.entries(configuracion.palabras)) {
      const variantes = claveGrupo.split("/").map(v => v.trim());
      let varianteCoincidente = null;
      let encontradaEnTitulo = false;
      let encontradaEnTexto = false;

      for (const variante of variantes) {
        const palabraNorm = normalizar(variante);
        const patron = escaparRegex(palabraNorm).replace(/\s+/g, "\\s+");
        const regex = new RegExp(`(^|[^a-z0-9áéíóúüñ])${patron}(?=$|[^a-z0-9áéíóúüñ])`, "i");

        if (regex.test(tituloNormalizado)) {
          encontradaEnTitulo = true;
          varianteCoincidente = variante;
          break;
        }
        if (regex.test(textoNormalizado)) {
          encontradaEnTexto = true;
          varianteCoincidente = variante;
        }
      }

      if (encontradaEnTitulo || encontradaEnTexto) {
        let pesoFinal = peso;
        if (encontradaEnTitulo) pesoFinal += 2;
        puntuacionTotal += pesoFinal;
        palabrasEncontradasSet.add(varianteCoincidente || claveGrupo);
      }
    }

    if (puntuacionTotal >= configuracion.umbral) {
      coincidencias.push({
        sector,
        puntuacion: puntuacionTotal,
        palabrasEncontradas: [...palabrasEncontradasSet]
      });
    }
  }

  return coincidencias;
}

async function supabaseRequest(ruta, opciones = {}) {
  const respuesta = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, {
    ...opciones,
    signal: AbortSignal.timeout(25000),
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(opciones.headers || {})
    }
  });

  if (!respuesta.ok) {
    const errorText = await respuesta.text();
    throw new Error(`Supabase ${respuesta.status}: ${errorText}`);
  }

  if (respuesta.status === 204) return null;
  const texto = await respuesta.text();
  return texto ? JSON.parse(texto) : null;
}

async function obtenerUrlsGuardadas() {
  const urls = new Set();
  const tamanioPagina = 1000;
  let desde = 0;

  while (true) {
    try {
      const hasta = desde + tamanioPagina - 1;
      const filas = await supabaseRequest(`anuncios_boja?select=url_pdf&order=id.asc`, {
        headers: { Range: `${desde}-${hasta}` }
      });

      const resultados = Array.isArray(filas) ? filas : [];
      for (const fila of resultados) {
        const urlNormalizada = normalizarUrlPdf(fila.url_pdf);
        if (urlNormalizada) urls.add(urlNormalizada);
      }

      if (resultados.length < tamanioPagina) break;
      desde += tamanioPagina;
    } catch {
      break;
    }
  }
  return urls;
}

async function obtenerUsuarios() {
  try {
    return (
      (await supabaseRequest(
        "perfiles_usuarios?select=id,email,sectores_suscritos,plan,estado_suscripcion,recibe_alertas&plan=eq.premium&estado_suscripcion=eq.activa&recibe_alertas=eq.true"
      )) || []
    );
  } catch {
    return [];
  }
}

async function guardarAnuncios(documentos) {
  if (documentos.length === 0 || DRY_RUN) return;

  const filas = documentos.map((documento) => ({
    titulo: documento.titulo.substring(0, 1000),
    url_pdf: documento.urlPdf,
    categoria: documento.sectores.length
      ? documento.sectores.map((sector) => sector.sector).join(", ")
      : "Sin coincidencias"
  }));

  await supabaseRequest("anuncios_boja?on_conflict=url_pdf", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(filas)
  });
}

async function guardarNotificaciones(notificaciones) {
  if (notificaciones.length === 0 || DRY_RUN) return;

  await supabaseRequest("notificaciones_web", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(notificaciones)
  });
}

function resolverSectoresUsuario(intereses = []) {
  const resultado = new Set();
  for (const interes of intereses) {
    const interesNormalizado = normalizar(interes);
    for (const sector of Object.keys(SECTORES)) {
      const sectorNormalizado = normalizar(sector);
      const coincide =
        sectorNormalizado.includes(interesNormalizado) ||
        interesNormalizado.includes(sectorNormalizado) ||
        sectorNormalizado.split(" ").some((palabra) => palabra.length > 4 && interesNormalizado.includes(palabra));

      if (coincide) resultado.add(sector);
    }
  }
  return resultado;
}

function crearHtmlCorreo(documentos) {
  const bloques = documentos
    .map((documento) => {
      const palabras = [...new Set(documento.coincidencias.flatMap((c) => c.palabrasEncontradas))];
      const sectores = documento.coincidencias.map((c) => c.sector).join(", ");

      return `
        <div style="margin:18px 0;padding:18px;background:#f8fafc;border-left:4px solid #008f6a;border-radius:7px;">
          <div style="color:#006b4f;font-size:13px;font-weight:bold;margin-bottom:8px;">
            ${escaparHtml(sectores)}
          </div>
          <h2 style="font-size:17px;line-height:1.4;color:#172033;margin:0 0 10px;">
            ${escaparHtml(documento.titulo)}
          </h2>
          <p style="font-size:13px;color:#64748b;line-height:1.5;">
            <strong>Coincidencias:</strong> ${escaparHtml(palabras.slice(0, 12).join(", "))}
          </p>
          <a href="${escaparHtml(documento.urlPdf)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#008f6a;color:white;text-decoration:none;padding:11px 16px;border-radius:6px;font-size:13px;font-weight:bold;">
            📄 Abrir PDF oficial exacto
          </a>
        </div>
      `;
    })
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;background:#f1f5f9;padding:24px;">
      <div style="max-width:680px;margin:auto;background:white;padding:26px;border-radius:10px;">
        <h1 style="color:#006b4f;margin:0;">BoletínHoy</h1>
        <p style="color:#64748b;margin-top:6px;">Alertas personalizadas del BOJA</p>
        <p style="color:#334155;line-height:1.6;">
          Hemos encontrado <strong>${documentos.length}</strong> ${documentos.length === 1 ? "publicación nueva" : "publicaciones nuevas"} relacionada${documentos.length === 1 ? "" : "s"} con tus sectores.
        </p>
        ${bloques}
        <p style="text-align:center;margin-top:24px;">
          <a href="https://boletinhoy.es" style="color:#006b4f;font-weight:bold;text-decoration:none;">
            Entrar en boletinhoy.es
          </a>
        </p>
      </div>
    </div>
  `;
}

async function enviarCorreo(email, documentos) {
  if (DRY_RUN) return { id: "dry-run-id" };

  const payload = {
    from: "BoletínHoy <alertas@boletinhoy.es>",
    to: [email],
    subject: `🔔 ${documentos.length} ${documentos.length === 1 ? "nueva publicación" : "nuevas publicaciones"} del BOJA`,
    html: crearHtmlCorreo(documentos)
  };

  const respuesta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(25000),
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const textoRespuesta = await respuesta.text();
  let jsonRespuesta = null;
  try {
    jsonRespuesta = textoRespuesta ? JSON.parse(textoRespuesta) : null;
  } catch {
    jsonRespuesta = { raw: textoRespuesta };
  }

  if (!respuesta.ok) {
    throw new Error(`Resend ${respuesta.status}: ${textoRespuesta}`);
  }

  return jsonRespuesta;
}

async function ejecutar() {
  console.log("==================================================");
  console.log("🚀 INICIANDO CAPTURADOR BOJA ROBUSTO (REFACCIÓN INCREMENTAL)");
  console.log("==================================================");

  const fechas = obtenerFechasRevision();

  // 3. Orden invertido de fuentes: PORTADA -> API -> ÍNDICES -> RSS (Fallback)
  console.log("\n🌐 Consultando fuentes oficiales en orden de prioridad robusta...");
  const pubsPortada = await obtenerPublicacionesDesdePortada(fechas);
  const pubsApi = await obtenerPublicacionesDesdeApi(fechas);
  const pubsIndices = await obtenerPublicacionesDesdeIndicesDiarios(fechas);
  
  let pubsRss = [];
  if (pubsPortada.length === 0 && pubsApi.length === 0 && pubsIndices.length === 0) {
    console.log("   ⚠️ Las fuentes principales fallaron. Intentando 4ª fuente (RSS)...");
    pubsRss = await obtenerPublicacionesDesdeRss(fechas);
  }

  console.log(`   ✅ Portada: ${pubsPortada.length}`);
  console.log(`   ✅ API: ${pubsApi.length}`);
  console.log(`   ✅ Índices: ${pubsIndices.length}`);
  console.log(`   ✅ RSS: ${pubsRss.length}`);

  // 4 & 5. Comparación cruzada de resultados e integridad entre fuentes
  const totalPortada = pubsPortada.length;
  const totalApi = pubsApi.length;
  const totalIndices = pubsIndices.length;

  console.log(`\n📊 Verificación de integridad entre fuentes:`);
  console.log(`   - Portada reporta: ${totalPortada} elementos`);
  console.log(`   - API reporta: ${totalApi} elementos`);
  console.log(`   - Índices reportan: ${totalIndices} elementos`);

  if (totalPortada > 0 && totalApi > 0 && Math.abs(totalPortada - totalApi) > 5) {
    console.warn(`   🚨 ALERTA DE DISCREPANCIA: Diferencia notable entre Portada (${totalPortada}) y API (${totalApi}).`);
  } else {
    console.log(`   ✅ Integridad de fuentes OK (sin discrepancias críticas).`);
  }

  const mapaPubs = new Map();
  for (const p of [...pubsPortada, ...pubsApi, ...pubsIndices, ...pubsRss]) {
    const clave = `${p.year}-${p.number}-${p.complement || "principal"}`;
    if (!mapaPubs.has(clave)) {
      mapaPubs.set(clave, p);
    } else {
      const existente = mapaPubs.get(clave);
      mapaPubs.set(clave, {
        ...existente,
        ...p,
        pdfUrl: p.pdfUrl || existente.pdfUrl,
        dispositionUrl: p.dispositionUrl || existente.dispositionUrl
      });
    }
  }

  const publicacionesUnicas = [...mapaPubs.values()];
  console.log(`\n📚 Total publicaciones tras fusionar y deduplicar: ${publicacionesUnicas.length}`);

  const documentosTotales = new Map();

  for (const pub of publicacionesUnicas) {
    const urlObjetivo = pub.dispositionUrl || pub.publicationUrl;
    try {
      const paginasSeccion = await obtenerPaginasSecciones(urlObjetivo);
      for (const pagina of paginasSeccion) {
        const docs = await obtenerDocumentosPagina(pagina);
        for (const doc of docs) {
          documentosTotales.set(doc.urlPdf, {
            ...doc,
            publicationInfo: pub
          });
        }
      }
    } catch (error) {
      console.log(`⚠️ No se pudo procesar la publicación ${urlObjetivo}: ${error.message}`);
    }
  }

  console.log(`📄 PDF o disposiciones localizadas en total: ${documentosTotales.size}`);

  let urlsGuardadas = new Set();
  try {
    urlsGuardadas = await obtenerUrlsGuardadas();
    console.log(`💾 Registros existentes en Supabase cargados: ${urlsGuardadas.size}`);
  } catch (error) {
    console.error(`❌ Error crítico obteniendo URLs de Supabase: ${error.message}`);
    return;
  }

  const documentosNuevos = [];
  let pdfDuplicadosDescartados = 0;

  for (const [urlPdf, doc] of documentosTotales.entries()) {
    if (urlsGuardadas.has(urlPdf)) {
      pdfDuplicadosDescartados++;
    } else {
      documentosNuevos.push(doc);
    }
  }

  console.log(`🗑️ Duplicados descartados: ${pdfDuplicadosDescartados}`);
  console.log(`🆕 Documentos nuevos pendientes de análisis: ${documentosNuevos.length}`);

  if (documentosNuevos.length === 0) {
    console.log("✅ No hay documentos nuevos.");
    console.log("\n==================================================");
    console.log("🏁 PROCESO FINALIZADO CON ÉXITO");
    console.log("==================================================");
    return;
  }

  // 7. Análisis concurrente con p-limit (concurrencia 3) para mayor velocidad
  const limit = pLimit(3);
  let pdfOmitidosTamanio = 0;

  console.log(`⚡ Iniciando análisis concurrente de PDFs (concurrencia: 3)...`);
  const tareasAnalisis = documentosNuevos.map((doc) =>
    limit(async () => {
      try {
        const texto = await extraerTextoPdf(doc.urlPdf);
        const tituloFinal = doc.tituloPagina || doc.publicationInfo?.title || "Documento publicado en el BOJA";
        const sectores = detectarSectores(texto, tituloFinal);

        return {
          ...doc,
          texto,
          titulo: tituloFinal,
          sectores
        };
      } catch (error) {
        if (error.message.includes("35 MB")) pdfOmitidosTamanio++;
        console.log(`⚠️ PDF omitido ${doc.urlPdf}: ${error.message}`);
        return null;
      }
    })
  );

  const resultadosAnalizados = await Promise.all(tareasAnalisis);
  const analizados = resultadosAnalizados.filter(Boolean);

  if (analizados.length === 0) {
    console.log("ℹ️ No se pudo analizar ningún PDF.");
    return;
  }

  let realmenteNuevos = analizados;
  if (!DRY_RUN) {
    const urlsActualizadas = await obtenerUrlsGuardadas();
    realmenteNuevos = analizados.filter(d => !urlsActualizadas.has(d.urlPdf));
  }

  if (realmenteNuevos.length > 0) {
    await guardarAnuncios(realmenteNuevos);
    console.log(`✅ Anuncios nuevos guardados en Supabase: ${realmenteNuevos.length}`);
  }

  const conCoincidencias = realmenteNuevos.filter(d => d.sectores.length > 0);
  console.log(`🎯 Documentos con coincidencias de sectores: ${conCoincidencias.length}`);

  if (conCoincidencias.length === 0) {
    console.log("ℹ️ No hay coincidencias para notificar.");
    console.log("\n==================================================");
    console.log("🏁 PROCESO FINALIZADO CON ÉXITO");
    console.log("==================================================");
    return;
  }

  let usuarios = [];
  try {
    usuarios = await obtenerUsuarios();
  } catch (error) {
    console.log(`⚠️ Error obteniendo usuarios de Supabase: ${error.message}`);
  }

  console.log(`👥 Usuarios Premium cargados: ${usuarios.length}`);

  const notificaciones = [];
  let alertasEnviadas = 0;
  let alertasFallidas = 0;

  for (const usuario of usuarios) {
    if (
      usuario.plan !== "premium" ||
      usuario.estado_suscripcion !== "activa" ||
      usuario.recibe_alertas !== true ||
      !usuario.email ||
      !Array.isArray(usuario.sectores_suscritos) ||
      usuario.sectores_suscritos.length === 0
    ) {
      continue;
    }

    const sectoresUsuario = resolverSectoresUsuario(usuario.sectores_suscritos);
    if (sectoresUsuario.size === 0) continue;

    const relevantes = conCoincidencias
      .map((documento) => {
        const coincidenciasValidas = documento.sectores.filter((sector) => sectoresUsuario.has(sector.sector));
        if (coincidenciasValidas.length > 0) {
          return {
            ...documento,
            coincidencias: coincidenciasValidas
          };
        }
        return null;
      })
      .filter(Boolean);

    if (relevantes.length === 0) continue;

    try {
      await enviarCorreo(usuario.email, relevantes);
      alertasEnviadas++;

      for (const rel of relevantes) {
        notificaciones.push({
          usuario_id: usuario.id,
          mensaje: `Novedad BOJA: ${rel.titulo}`,
          leida: false
        });
      }
    } catch (error) {
      alertasFallidas++;
      console.log(`❌ Error al enviar correo a ${usuario.email}: ${error.message}`);
    }
  }

  if (notificaciones.length > 0) {
    try {
      await guardarNotificaciones(notificaciones);
    } catch {}
  }

  console.log(`\n📨 Alertas enviadas: ${alertasEnviadas}`);
  console.log(`⚠️ Alertas fallidas: ${alertasFallidas}`);
  console.log("\n==================================================");
  console.log("✅ EJECUCIÓN FINALIZADA CORRECTAMENTE");
  console.log("==================================================");
}

ejecutar().catch((error) => {
  console.error("❌ Error crítico en el proceso:", error);
  process.exit(1);
});
