const cheerio = require("cheerio");
const pdfParse = require("pdf-parse");
const pLimit = require("p-limit");
const FeedParser = require("feedparser");
const { Readable } = require("stream");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "")
  .replace(/\/rest\/v1\/?$/i, "")
  .replace(/\/+$/, "");

const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const BASE_BOJA = "https://www.juntadeandalucia.es/eboja";
const BASE_API_BOJA = "https://datos.juntadeandalucia.es/api/v0/boja";
const RSS_BOJA = "https://www.juntadeandalucia.es/eboja/rss.xml";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0; +https://boletinhoy.es)";

const DRY_RUN = process.env.DRY_RUN === "true";
const TARGET_DATE = process.env.TARGET_DATE || null;

if (!SUPABASE_URL || !SUPABASE_KEY || !RESEND_API_KEY) {
  console.error("❌ Faltan SUPABASE_URL, SUPABASE_KEY o RESEND_API_KEY.");
  process.exit(1);
}

const executionCache = new Map();

async function fetchCached(url, accept = "*/*", intentos = 3) {
  if (executionCache.has(url)) {
    return executionCache.get(url).clone();
  }

  const respuesta = await descargar(url, accept, intentos);
  executionCache.set(url, respuesta.clone());
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
    for (const [key] of [...parsed.searchParams.entries()]) {
      if (key.toLowerCase().startsWith("utm_")) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizarUrlPagina(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const [key] of [...parsed.searchParams.entries()]) {
      if (key.toLowerCase().startsWith("utm_")) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
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
          await new Promise(res => setTimeout(res, Math.pow(2, intento) * 1000));
          continue;
        }
        throw new Error(`HTTP ${respuesta.status} al consultar ${url}`);
      }

      return respuesta;
    } catch (error) {
      ultimoError = error;
      if (error.message.includes("404")) throw error;
      if (intento < intentos) {
        await new Promise(res => setTimeout(res, Math.pow(2, intento) * 1000));
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
  return fechas;
}

function extraerDatosPublicacion(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "www.juntadeandalucia.es") return null;
    const pathname = parsed.pathname.replace(/\/index\.html$/i, "/").replace(/\/+$/, "/");
    const match = pathname.match(/^\/eboja\/(\d{4})\/(\d+)\/(?:(c\d{2,3})\/)?$/i);
    if (!match) return null;

    return {
      year: parseInt(match[1], 10),
      number: match[2],
      complement: match[3]?.toLowerCase() || null,
      publicationUrl: `${parsed.protocol}//${parsed.host}${pathname}`
    };
  } catch {
    return null;
  }
}

async function obtenerPublicacionesDesdeRss(fechas) {
  const publicaciones = [];
  try {
    const resp = await fetch(RSS_BOJA, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(20000)
    });
    if (!resp.ok) {
      console.warn(`⚠️ RSS BOJA respondió con estado ${resp.status}`);
      return publicaciones;
    }

    const feedparser = new FeedParser();
    const stream = Readable.fromWeb(resp.body);

    await new Promise((resolve) => {
      stream.pipe(feedparser);
      feedparser.on("error", (err) => {
        console.warn(`⚠️ Error procesando RSS Feedparser: ${err.message}`);
        resolve();
      });
      feedparser.on("end", () => resolve());
      feedparser.on("readable", function () {
        let item;
        while ((item = this.read())) {
          const fechaPub = item.date ? item.date.toISOString().substring(0, 10) : fechas[0].fechaIso;
          const coincideFecha = fechas.some(f => fechaPub.includes(f.fechaIso));
          if (!coincideFecha && fechas.length > 0) continue;

          const urlDisp = item.link || null;
          let urlPdf = null;
          if (item.enclosures && item.enclosures.length > 0) {
            urlPdf = item.enclosures[0].url;
          }

          publicaciones.push({
            source: "rss",
            cve: item.guid || null,
            officialId: item.meta?.title || null,
            year: new Date(fechaPub).getFullYear(),
            number: fechaPub.replace(/-/g, ""),
            publicationDate: fechaPub,
            publicationUrl: urlDisp ? normalizarUrlPagina(urlDisp) : `${BASE_BOJA}.html`,
            dispositionUrl: urlDisp ? normalizarUrlPagina(urlDisp) : null,
            pdfUrl: urlPdf ? normalizarUrlPdf(urlPdf) : null,
            title: item.title || "Documento BOJA RSS",
            summary: item.summary || item.description || "",
            organisation: item.author || "",
            section: item.categories ? item.categories.join(", ") : ""
          });
        }
      });
    });
  } catch (error) {
    console.warn(`⚠️ Error al obtener publicaciones desde RSS (${RSS_BOJA}): ${error.message}`);
  }
  return publicaciones;
}

async function obtenerPublicacionesDesdeApi(fechas) {
  const publicaciones = [];
  const aniosProcesados = new Set(fechas.map(f => f.anio));

  for (const anio of aniosProcesados) {
    try {
      const urlApi = `${BASE_API_BOJA}/all?year=${anio}&format=json`;
      const resp = await fetchCached(urlApi, "application/json");
      const json = await resp.json();
      const items = Array.isArray(json) ? json : (json?.results || json?.items || json?.data || []);

      for (const item of items) {
        const fechaPub = item.fecha || item.date || item.publicationDate || "";
        const coincideFecha = fechas.some(f => fechaPub.includes(f.fechaIso) || fechaPub.includes(f.formatoFecha));
        if (!coincideFecha && fechas.length > 0) continue;

        const urlDisp = item.url || item.enlace || item.link || item.uri || null;
        const urlPdf = item.url_pdf || item.pdf || item.documentoPdf || null;
        const cve = item.cve || item.codigoVerificacion || null;
        const officialId = item.id || item.codigo || item.guid || null;

        publicaciones.push({
          source: "api",
          cve,
          officialId,
          year: parseInt(anio, 10),
          number: item.numero || item.number || anio,
          publicationDate: fechaPub ? fechaPub.substring(0, 10) : fechas[0].fechaIso,
          publicationUrl: urlDisp ? normalizarUrlPagina(urlDisp) : `${BASE_BOJA}/${anio}.html`,
          dispositionUrl: urlDisp ? normalizarUrlPagina(urlDisp) : null,
          pdfUrl: urlPdf ? normalizarUrlPdf(urlPdf) : null,
          title: item.titulo || item.title || item.asunto || "Documento BOJA",
          summary: item.resumen || item.summary || "",
          organisation: item.organismo || item.organisation || "",
          section: item.seccion || item.section || ""
        });
      }
    } catch (error) {
      console.warn(`⚠️ Error al consultar API del BOJA (${BASE_API_BOJA}): ${error.message}`);
    }
  }
  return publicaciones;
}

async function obtenerPublicacionesDesdePortada(fechas) {
  const publicaciones = [];
  const portadaUrl = `${BASE_BOJA}.html`;
  try {
    const resp = await fetchCached(portadaUrl, "text/html");
    const html = await resp.text();
    const $ = cheerio.load(html);

    let fechaRealDetectada = fechas[0].fechaIso;
    let anioReal = fechas[0].anio;
    let numeroReal = fechas[0].formatoFecha;

    const textoEncabezadoOficial = $("h1.fecha, h2.fecha, .fecha-boja, header .fecha, .fechaBoja").first().text().trim() ||
                                   $(".contenido-portada h2, .main-content h2").first().text().trim();

    const matchFecha = textoEncabezadoOficial.match(/(\d{1,2})\s+de\s+([a-zA-Záéíóúüñ]+)\s+de\s+(\d{4})/i) ||
                       textoEncabezadoOficial.match(/(\d{1,2})[^\w](\d{1,2})[^\w](\d{4})/);

    if (matchFecha) {
      if (matchFecha[2] && isNaN(matchFecha[2])) {
        const meses = { enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06", julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12" };
        const d = matchFecha[1].padStart(2, "0");
        const m = meses[normalizar(matchFecha[2])] || "01";
        const a = matchFecha[3];
        fechaRealDetectada = `${a}-${m}-${d}`;
        anioReal = a;
        numeroReal = `${a}${m}${d}`;
      } else if (matchFecha[2]) {
        const d = matchFecha[1].padStart(2, "0");
        const m = matchFecha[2].padStart(2, "0");
        const a = matchFecha[3];
        fechaRealDetectada = `${a}-${m}-${d}`;
        anioReal = a;
        numeroReal = `${a}${m}${d}`;
      }
    }

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      const abs = urlAbsoluta(href, BASE_BOJA);
      if (!abs) return;

      const datos = extraerDatosPublicacion(abs);
      if (datos) {
        publicaciones.push({
          source: "portada",
          cve: null,
          officialId: null,
          year: parseInt(anioReal, 10),
          number: numeroReal,
          complement: datos.complement,
          publicationDate: fechaRealDetectada,
          publicationUrl: datos.publicationUrl,
          dispositionUrl: null,
          pdfUrl: null,
          title: $(el).text().trim() || "Boletín Oficial",
          summary: "",
          organisation: "",
          section: ""
        });
      }
    });
  } catch (error) {
    console.warn(`⚠️ Error al obtener publicaciones desde la Portada (${portadaUrl}): ${error.message}`);
  }
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
            cve: null,
            officialId: null,
            year: datos.year,
            number: datos.number,
            complement: datos.complement,
            publicationDate: f.fechaIso,
            publicationUrl: datos.publicationUrl,
            dispositionUrl: abs,
            pdfUrl: /\.pdf$/i.test(abs) ? normalizarUrlPdf(abs) : null,
            title: $(el).text().trim() || "Disposición BOJA",
            summary: "",
            organisation: "",
            section: ""
          });
        }
      });
    } catch (error) {
      console.warn(`⚠️ Aviso: No se pudo cargar el índice diario para ${f.formatoFecha} (${urlFecha}): ${error.message}`);
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
  } catch (error) {
    console.warn(`⚠️ No se pudieron obtener secciones secundarias para ${publicacionUrl}: ${error.message}`);
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
    if (limpio.length >= 25) return limpio.substring(0, 1000);
  }
  return "Documento publicado en el BOJA";
}

async function esUrlPdfValida(urlPdfAbs) {
  if (/\.pdf(?:$|[?#])/i.test(urlPdfAbs)) return true;
  try {
    const respHead = await fetch(urlPdfAbs, { method: "HEAD", signal: AbortSignal.timeout(10000), headers: { "User-Agent": USER_AGENT } });
    if ((respHead.headers.get("content-type") || "").toLowerCase().includes("application/pdf")) return true;
  } catch {}
  return false;
}

async function obtenerDocumentosPagina(urlPagina) {
  try {
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

      let cve = null;
      const matchCve = (urlPdfNorm + " " + contexto).match(/cve-[0-9a-f-]+/i);
      if (matchCve) cve = matchCve[0].toUpperCase();

      documentos.set(urlPdfNorm, {
        cve,
        urlPdf: urlPdfNorm,
        tituloPagina: obtenerTituloCercano($, enlace),
        urlSeccion: resp.url
      });
    }

    return [...documentos.values()];
  } catch (error) {
    console.warn(`⚠️ Error al extraer documentos de la página ${urlPagina}: ${error.message}`);
    return [];
  }
}

async function extraerTextoPdf(urlPdf) {
  const respuesta = await descargar(urlPdf, "application/pdf");
  const buffer = Buffer.from(await respuesta.arrayBuffer());
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`El contenido descargado en ${urlPdf} no es un PDF válido.`);
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
    throw new Error(`Supabase ${respuesta.status} en endpoint ${ruta}: ${errorText}`);
  }

  if (respuesta.status === 204) return null;
  const texto = await respuesta.text();
  return texto ? JSON.parse(texto) : null;
}

async function obtenerUrlsGuardadas() {
  const urls = new Set();
  let desde = 0;
  while (true) {
    const filas = await supabaseRequest(`anuncios_boja?select=url_pdf&order=id.asc`, {
      headers: { Range: `${desde}-${desde + 999}` }
    });
    const resultados = Array.isArray(filas) ? filas : [];
    for (const fila of resultados) {
      const u = normalizarUrlPdf(fila.url_pdf);
      if (u) urls.add(u);
    }
    if (resultados.length < 1000) break;
    desde += 1000;
  }
  return urls;
}

async function obtenerUsuarios() {
  return (
    (await supabaseRequest(
      "perfiles_usuarios?select=id,email,sectores_suscritos,plan,estado_suscripcion,recibe_alertas&plan=eq.premium&estado_suscripcion=eq.activa&recibe_alertas=eq.true"
    )) || []
  );
}

async function guardarAnuncios(documentos) {
  if (documentos.length === 0 || DRY_RUN) return;
  const filas = documentos.map((documento) => ({
    cve: documento.cve || null,
    titulo: documento.titulo.substring(0, 1000),
    url_pdf: documento.urlPdf,
    categoria: documento.sectores.length ? documento.sectores.map(s => s.sector).join(", ") : "Sin coincidencias"
  }));

  await supabaseRequest("anuncios_boja?on_conflict=url_pdf", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
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

async function verificarYRegistrarIdempotenciaEnvio(usuarioId, documentosClaves) {
  if (DRY_RUN) return false;
  const hashLote = documentosClaves.sort().join(",");
  try {
    const resultado = await supabaseRequest(`alertas_enviadas`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ usuario_id: usuarioId, lote_hash: hashLote })
    });
    return !resultado || (Array.isArray(resultado) && resultado.length === 0);
  } catch (error) {
    if (error.message.includes("23505") || error.message.includes("duplicate key")) {
      return true;
    }
    throw error;
  }
}

function resolverSectoresUsuario(intereses = []) {
  const resultado = new Set();
  for (const interes of intereses) {
    const interesNormalizado = normalizar(interes);
    for (const sector of Object.keys(SECTORES)) {
      const sectorNormalizado = normalizar(sector);
      if (sectorNormalizado.includes(interesNormalizado) || interesNormalizado.includes(sectorNormalizado)) {
        resultado.add(sector);
      }
    }
  }
  return resultado;
}

function crearHtmlCorreo(documentos) {
  const bloques = documentos.map((documento) => {
    const palabras = [...new Set(documento.coincidencias.flatMap(c => c.palabrasEncontradas))];
    const sectores = documento.coincidencias.map(c => c.sector).join(", ");
    return `
      <div style="margin:18px 0;padding:18px;background:#f8fafc;border-left:4px solid #008f6a;border-radius:7px;">
        <div style="color:#006b4f;font-size:13px;font-weight:bold;margin-bottom:8px;">${escaparHtml(sectores)}</div>
        <h2 style="font-size:17px;line-height:1.4;color:#172033;margin:0 0 10px;">${escaparHtml(documento.titulo)}</h2>
        <p style="font-size:13px;color:#64748b;line-height:1.5;"><strong>Coincidencias:</strong> ${escaparHtml(palabras.slice(0, 12).join(", "))}</p>
        <a href="${escaparHtml(documento.urlPdf)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#008f6a;color:white;text-decoration:none;padding:11px 16px;border-radius:6px;font-size:13px;font-weight:bold;">📄 Abrir PDF oficial exacto</a>
      </div>
    `;
  }).join("");

  return `
    <div style="font-family:Arial,sans-serif;background:#f1f5f9;padding:24px;">
      <div style="max-width:680px;margin:auto;background:white;padding:26px;border-radius:10px;">
        <h1 style="color:#006b4f;margin:0;">BoletínHoy</h1>
        <p style="color:#64748b;margin-top:6px;">Alertas personalizadas del BOJA</p>
        <p style="color:#334155;line-height:1.6;">Hemos encontrado <strong>${documentos.length}</strong> publicaciones nuevas relacionadas contigo.</p>
        ${bloques}
      </div>
    </div>
  `;
}

async function enviarCorreo(email, documentos) {
  if (DRY_RUN) return { id: "dry-run-id" };
  const payload = {
    from: "BoletínHoy <alertas@boletinhoy.es>",
    to: [email],
    subject: `🔔 ${documentos.length} nuevas publicaciones del BOJA`,
    html: crearHtmlCorreo(documentos)
  };

  const respuesta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(25000),
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!respuesta.ok) throw new Error(`Resend ${respuesta.status}: ${await respuesta.text()}`);
  return respuesta.json();
}

async function ejecutar() {
  console.log("🚀 INICIANDO CAPTURADOR BOJA CON AUDITORÍA FUNCIONAL Y LOGS DETALLADOS");
  const fechas = obtenerFechasRevision();
  console.log(`📅 Fechas de revisión calculadas:`, fechas.map(f => f.fechaIso));

  const pubsRss = await obtenerPublicacionesDesdeRss(fechas);
  console.log(`📊 Publicaciones obtenidas del RSS: ${pubsRss.length}`);

  const pubsPortada = await obtenerPublicacionesDesdePortada(fechas);
  console.log(`📊 Publicaciones obtenidas de la Portada: ${pubsPortada.length}`);

  const pubsApi = await obtenerPublicacionesDesdeApi(fechas);
  console.log(`📊 Publicaciones obtenidas de la API: ${pubsApi.length}`);

  const pubsIndices = await obtenerPublicacionesDesdeIndicesDiarios(fechas);
  console.log(`📊 Publicaciones obtenidas de los Índices Diarios: ${pubsIndices.length}`);

  const mapaDisposiciones = new Map();
  for (const p of [...pubsRss, ...pubsPortada, ...pubsApi, ...pubsIndices]) {
    const claveDedupl = p.cve || p.officialId || p.pdfUrl || p.dispositionUrl || `${p.year}-${p.number}-${p.title}`;
    if (!mapaDisposiciones.has(claveDedupl)) {
      mapaDisposiciones.set(claveDedupl, p);
    } else {
      const existente = mapaDisposiciones.get(claveDedupl);
      mapaDisposiciones.set(claveDedupl, {
        ...existente,
        ...p,
        pdfUrl: p.pdfUrl || existente.pdfUrl,
        dispositionUrl: p.dispositionUrl || existente.dispositionUrl,
        cve: p.cve || existente.cve
      });
    }
  }

  const publicacionesUnicas = [...mapaDisposiciones.values()];
  console.log(`🔗 Total de publicaciones únicas consolidadas: ${publicacionesUnicas.length}`);

  const documentosTotales = new Map();

  for (const pub of publicacionesUnicas) {
    const urlObjetivo = pub.dispositionUrl || pub.publicationUrl;
    try {
      const paginasSeccion = await obtenerPaginasSecciones(urlObjetivo);
      for (const pagina of paginasSeccion) {
        const docs = await obtenerDocumentosPagina(pagina);
        for (const doc of docs) {
          const claveDoc = doc.cve || doc.urlPdf;
          if (!documentosTotales.has(claveDoc)) {
            documentosTotales.set(claveDoc, { ...doc, publicationInfo: pub });
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️ Error explorando secciones para la publicación ${urlObjetivo}: ${error.message}`);
    }
  }

  console.log(`📄 Total de PDFs encontrados en las páginas/secciones: ${documentosTotales.size}`);

  let urlsGuardadas = new Set();
  try {
    urlsGuardadas = await obtenerUrlsGuardadas();
    console.log(`🗄️ URLs de PDFs ya existentes en Supabase: ${urlsGuardadas.size}`);
  } catch (error) {
    console.error(`❌ Error crítico al consultar Supabase URLs guardadas: ${error.message}`);
    process.exit(1);
  }

  const documentosNuevos = [];
  for (const [claveDoc, doc] of documentosTotales.entries()) {
    if (!urlsGuardadas.has(doc.urlPdf)) {
      documentosNuevos.push(doc);
    }
  }

  console.log(`✨ Total de documentos considerados nuevos (pendientes de analizar): ${documentosNuevos.length}`);

  if (documentosNuevos.length === 0) {
    console.log("✅ No hay documentos nuevos.");
    return;
  }

  const limit = pLimit(3);
  let analizadosExitosos = 0;
  const tareasAnalisis = documentosNuevos.map((doc) =>
    limit(async () => {
      try {
        const texto = await extraerTextoPdf(doc.urlPdf);
        analizadosExitosos++;
        const tituloFinal = doc.tituloPagina || doc.publicationInfo?.title || "Documento BOJA";
        const sectores = detectarSectores(texto, tituloFinal);
        return { ...doc, texto, titulo: tituloFinal, sectores };
      } catch (error) {
        console.warn(`⚠️ Error al analizar el PDF ${doc.urlPdf}: ${error.message}`);
        return null;
      }
    })
  );

  const analizados = (await Promise.all(tareasAnalisis)).filter(Boolean);
  console.log(`🔍 Total de PDFs analizados correctamente: ${analizados.length} (Exitosos: ${analizadosExitosos})`);

  if (analizados.length > 0) {
    await guardarAnuncios(analizados);
    console.log(`💾 Guardados ${analizados.length} anuncios nuevos en Supabase.`);
  }

  const conCoincidencias = analizados.filter(d => d.sectores.length > 0);
  let usuarios = [];
  try {
    usuarios = await obtenerUsuarios();
    console.log(`👥 Usuarios premium con alertas activas obtenidos: ${usuarios.length}`);
  } catch (error) {
    console.warn(`⚠️ No se pudieron obtener los usuarios de Supabase: ${error.message}`);
  }

  let alertasEnviadas = 0;
  for (const usuario of usuarios) {
    if (!usuario.email || !Array.isArray(usuario.sectores_suscritos)) continue;
    const sectoresUsuario = resolverSectoresUsuario(usuario.sectores_suscritos);
    if (sectoresUsuario.size === 0) continue;

    const relevantes = conCoincidencias.map((documento) => {
      const coincidenciasValidas = documento.sectores.filter(s => sectoresUsuario.has(s.sector));
      return coincidenciasValidas.length > 0 ? { ...documento, coincidencias: coincidenciasValidas } : null;
    }).filter(Boolean);

    if (relevantes.length === 0) continue;

    const clavesLote = relevantes.map(r => r.urlPdf);
    const yaEnviado = await verificarYRegistrarIdempotenciaEnvio(usuario.id, clavesLote);
    if (yaEnviado) continue;

    try {
      await enviarCorreo(usuario.email, relevantes);
      alertasEnviadas++;
    } catch (error) {
      console.error(`❌ Error al enviar correo de alerta a ${usuario.email}: ${error.message}`);
    }
  }

  console.log(`🏁 FIN. Documentos nuevos analizados: ${analizados.length}, Correos/Alertas enviadas: ${alertasEnviadas}`);
}

ejecutar().catch((error) => {
  console.error("❌ Error crítico en la ejecución principal:", error);
  process.exit(1);
});
