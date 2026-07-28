const cheerio = require("cheerio");
const pdfParse = require("pdf-parse");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "")
  .replace(/\/rest\/v1\/?$/i, "")
  .replace(/\/+$/, "");

const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const BASE_BOJA = "https://www.juntadeandalucia.es/eboja";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0; +https://boletinhoy.es)";
const MAX_PDF_BYTES = 35 * 1024 * 1024;

if (!SUPABASE_URL || !SUPABASE_KEY || !RESEND_API_KEY) {
  console.error("❌ Faltan SUPABASE_URL, SUPABASE_KEY o RESEND_API_KEY.");
  process.exit(1);
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

function extraerDatosPublicacion(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname !== "www.juntadeandalucia.es") {
      return null;
    }

    const pathname = parsed.pathname
      .replace(/\/index\.html$/i, "/")
      .replace(/\/+$/, "/");

    const match = pathname.match(
      /^\/eboja\/(\d{4})\/(\d+)\/(?:(c\d{2,3})\/)?$/i
    );

    if (!match) {
      return null;
    }

    return {
      anio: match[1],
      numero: match[2],
      complemento: match[3]?.toLowerCase() || null,
      url: `${parsed.protocol}//${parsed.host}${pathname}`
    };
  } catch {
    return null;
  }
}

function normalizarUrlPdf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function normalizarUrlPagina(url) {
  try {
    const parsed = new URL(url);
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

async function descargar(url, accept = "*/*") {
  const respuesta = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(45000),
    headers: {
      "User-Agent": USER_AGENT,
      Accept: accept,
      "Accept-Language": "es-ES,es;q=0.9"
    }
  });

  if (!respuesta.ok) {
    throw new Error(`HTTP ${respuesta.status} al consultar ${url}`);
  }

  return respuesta;
}

function obtenerFechasRevision() {
  const fechas = [];
  const ahora = new Date();
  
  for (let i = 0; i < 3; i++) {
    const d = new Date(ahora.getTime() - (i * 24 * 60 * 60 * 1000));
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
      formatoFecha: `${anio}${mes}${dia}`
    });
  }
  console.log(`📅 Fechas revisadas (Europe/Madrid):`, fechas.map(f => f.formatoFecha));
  return fechas;
}

function validarHtmlPublicacion(html, urlPublicacion) {
  const $ = cheerio.load(html);
  const texto = normalizar($("body").text());

  if (
    texto.length < 100 ||
    (!texto.includes("boletin oficial") && !texto.includes("boja"))
  ) {
    return false;
  }

  let tieneContenidoBoja = false;

  $("a[href]").each((_, elemento) => {
    const href = $(elemento).attr("href");
    const absoluta = urlAbsoluta(href, urlPublicacion);

    if (!absoluta) {
      return;
    }

    try {
      const pathname = new URL(absoluta).pathname;
      if (
        /\/s\d+\.html$/i.test(pathname) ||
        /\.pdf$/i.test(pathname)
      ) {
        tieneContenidoBoja = true;
      }
    } catch {}
  });

  return tieneContenidoBoja;
}

async function descubrirPublicaciones() {
  const fechasRevisar = obtenerFechasRevision();
  const publicacionesValidas = [];
  const urlsProcesadas = new Set();

  for (const item of fechasRevisar) {
    const urlFecha = `${BASE_BOJA}/${item.formatoFecha}.html`;

    try {
      const respuesta = await descargar(urlFecha, "text/html");
      const html = await respuesta.text();
      console.log(`🔍 Índice diario encontrado: ${urlFecha}`);

      const $ = cheerio.load(html);
      const textoBody = normalizar($("body").text());

      if (textoBody.length > 100 && (textoBody.includes("boletin oficial") || textoBody.includes("boja"))) {
        $("a[href]").each((_, el) => {
          const href = $(el).attr("href");
          const absoluta = urlAbsoluta(href, respuesta.url);
          if (!absoluta) return;

          const datos = extraerDatosPublicacion(absoluta);
          if (!datos) {
            return;
          }

          if (!urlsProcesadas.has(datos.url)) {
            urlsProcesadas.add(datos.url);
            console.log(`   📌 Publicación válida detectada -> Año: ${datos.anio}, Número: ${datos.numero}, Complemento: ${datos.complemento || "Ninguno"}`);
            publicacionesValidas.push(datos);
          }
        });
      }
    } catch {
      console.log(`   ⚠️ Índice diario no disponible o sin BOJA: ${urlFecha}`);
    }
  }

  const publicacionesValidadasFinal = [];
  for (const pub of publicacionesValidas) {
    try {
      const resp = await descargar(pub.url, "text/html");
      const contentHtml = await resp.text();

      if (validarHtmlPublicacion(contentHtml, pub.url)) {
        publicacionesValidadasFinal.push({
          ...pub,
          html: contentHtml
        });
        console.log(`   ✅ Publicación verificada correctamente: ${pub.url}`);
      }
    } catch {
      console.log(`   ⚠️ Publicación inaccesible o no válida: ${pub.url}`);
    }
  }

  return publicacionesValidadasFinal;
}

async function obtenerPaginasSecciones(publicacion) {
  let html = publicacion.html;
  if (!html) {
    try {
      const respuesta = await descargar(publicacion.url, "text/html");
      html = await respuesta.text();
    } catch {
      return [publicacion.url];
    }
  }

  const $ = cheerio.load(html);
  const paginas = new Set([publicacion.url]);

  $("a[href]").each((_, elemento) => {
    const href = $(elemento).attr("href");
    const absoluta = urlAbsoluta(href, publicacion.url);
    if (!absoluta || !absoluta.startsWith(publicacion.url)) {
      return;
    }

    try {
      const parsedPath = new URL(absoluta).pathname;
      if (/\/s\d+\.html$/i.test(parsedPath)) {
        const limpia = normalizarUrlPagina(absoluta);
        if (limpia) {
          paginas.add(limpia);
          console.log(`      📁 Sección encontrada: ${limpia}`);
        }
      }
    } catch {}
  });

  return [...paginas];
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

async function obtenerDocumentosPagina(urlPagina) {
  const respuesta = await descargar(urlPagina, "text/html");
  const html = await respuesta.text();
  const $ = cheerio.load(html);
  const documentos = new Map();

  $("a[href]").each((_, elemento) => {
    const enlace = $(elemento);
    const href = enlace.attr("href") || "";
    const textoEnlace = normalizar(enlace.text());

    const esPdfValido = /\.pdf(?:$|[?#])/i.test(href) || textoEnlace.includes("pdf oficial autentico");
    if (!esPdfValido) {
      return;
    }

    const urlPdfAbs = urlAbsoluta(href, respuesta.url);
    if (!urlPdfAbs) {
      return;
    }

    const urlPdfNorm = normalizarUrlPdf(urlPdfAbs);
    if (!urlPdfNorm) {
      return;
    }

    const contexto = normalizar(enlace.closest("li,article,div").text());
    if (contexto.includes("boletin completo") || contexto.includes("sumario boletin")) {
      return;
    }

    documentos.set(urlPdfNorm, {
      urlPdf: urlPdfNorm,
      tituloPagina: obtenerTituloCercano($, elemento),
      urlSeccion: respuesta.url
    });
  });

  return [...documentos.values()];
}

async function obtenerDocumentosPublicacion(publicacion) {
  const paginas = await obtenerPaginasSecciones(publicacion);
  const mapa = new Map();

  for (const pagina of paginas) {
    try {
      const documentos = await obtenerDocumentosPagina(pagina);
      for (const documento of documentos) {
        mapa.set(documento.urlPdf, documento);
      }
    } catch (error) {
      console.log(`⚠️ Página omitida ${pagina}: ${error.message}`);
    }
  }

  return [...mapa.values()];
}

async function extraerTextoPdf(urlPdf) {
  const respuesta = await descargar(urlPdf, "application/pdf");
  const contentType = normalizar(
    respuesta.headers.get("content-type") || ""
  );

  if (
    contentType &&
    !contentType.includes("application/pdf") &&
    !contentType.includes("application/octet-stream")
  ) {
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

  const escaparRegex = valor =>
    valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
        const regex = new RegExp(
          `(^|[^a-z0-9áéíóúüñ])${patron}(?=$|[^a-z0-9áéíóúüñ])`,
          "i"
        );

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
        if (encontradaEnTitulo) {
          pesoFinal += 2;
        }
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
    signal: AbortSignal.timeout(45000),
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(opciones.headers || {})
    }
  });

  if (!respuesta.ok) {
    const errorText = await respuesta.text();
    console.error(`❌ Error Supabase ${respuesta.status} en ${ruta}: ${errorText}`);
    throw new Error(`Supabase ${respuesta.status}: ${errorText}`);
  }

  if (respuesta.status === 204) {
    return null;
  }

  const texto = await respuesta.text();
  return texto ? JSON.parse(texto) : null;
}

async function obtenerUrlsGuardadas() {
  const urls = new Set();
  const tamanioPagina = 1000;
  let desde = 0;

  while (true) {
    const hasta = desde + tamanioPagina - 1;

    const filas = await supabaseRequest(
      `anuncios_boja?select=url_pdf&order=id.asc`,
      {
        headers: {
          Range: `${desde}-${hasta}`
        }
      }
    );

    const resultados = Array.isArray(filas) ? filas : [];

    for (const fila of resultados) {
      const urlNormalizada = normalizarUrlPdf(fila.url_pdf);

      if (urlNormalizada) {
        urls.add(urlNormalizada);
      }
    }

    if (resultados.length < tamanioPagina) {
      break;
    }

    desde += tamanioPagina;
  }

  return urls;
}
async function obtenerUsuarios() {
  return (
    (
      await supabaseRequest(
        "perfiles_usuarios" +
        "?select=id,email,sectores_suscritos,plan,estado_suscripcion,recibe_alertas" +
        "&plan=eq.premium" +
        "&estado_suscripcion=eq.activa" +
        "&recibe_alertas=eq.true"
      )
    ) || []
  );
}


async function guardarAnuncios(documentos) {
  if (documentos.length === 0) {
    return;
  }

  const filas = documentos.map((documento) => ({
    titulo: documento.titulo.substring(0, 1000),
    url_pdf: documento.urlPdf,
    categoria: documento.sectores.length
      ? documento.sectores.map((sector) => sector.sector).join(", ")
      : "Sin coincidencias"
  }));

  await supabaseRequest(
    "anuncios_boja?on_conflict=url_pdf",
    {
      method: "POST",
      headers: {
        Prefer: "resolution=ignore-duplicates,return=representation"
      },
      body: JSON.stringify(filas)
    }
  );
}

async function guardarNotificaciones(notificaciones) {
  if (notificaciones.length === 0) {
    return;
  }

  await supabaseRequest("notificaciones_web", {
    method: "POST",
    headers: {
      Prefer: "return=minimal"
    },
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
        sectorNormalizado.split(" ").some(
          (palabra) => palabra.length > 4 && interesNormalizado.includes(palabra)
        );

      if (coincide) {
        resultado.add(sector);
      }
    }
  }

  return resultado;
}

function crearHtmlCorreo(documentos) {
  const bloques = documentos
    .map((documento) => {
      const palabras = [
        ...new Set(
          documento.coincidencias.flatMap((coincidencia) => coincidencia.palabrasEncontradas)
        )
      ];

      const sectores = documento.coincidencias
        .map((coincidencia) => coincidencia.sector)
        .join(", ");

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
  const payload = {
    from: "BoletínHoy <alertas@boletinhoy.es>",
    to: [email],
    subject: `🔔 ${documentos.length} ${documentos.length === 1 ? "nueva publicación" : "nuevas publicaciones"} del BOJA`,
    html: crearHtmlCorreo(documentos)
  };

  const respuesta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(45000),
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

  console.log(`[Resend Log] Email: ${email} | Status: ${respuesta.status} | ID: ${jsonRespuesta?.id || "N/A"} | Body: ${textoRespuesta}`);

  if (!respuesta.ok) {
    throw new Error(`Resend ${respuesta.status}: ${textoRespuesta}`);
  }

  return jsonRespuesta;
}

async function ejecutar() {
  console.log("==================================================");
  console.log("🚀 INICIANDO CAPTURADOR BOJA OPTIMIZADO");
  console.log("==================================================");

  let publicaciones = [];
  try {
    publicaciones = await descubrirPublicaciones();
  } catch (error) {
    console.log(`⚠️ Error crítico descubriendo publicaciones: ${error.message}`);
    return;
  }

  console.log(`📚 Publicaciones válidas totales: ${publicaciones.length}`);

  const documentosTotales = new Map();

  for (const publicacion of publicaciones) {
    console.log(`🔍 Revisando publicación: ${publicacion.url}`);
    try {
      const documentos = await obtenerDocumentosPublicacion(publicacion);
      console.log(`   PDF localizados en esta publicación: ${documentos.length}`);
      for (const documento of documentos) {
        documentosTotales.set(documento.urlPdf, documento);
      }
    } catch (error) {
      console.log(`⚠️ No se pudo revisar ${publicacion.url}: ${error.message}`);
    }
  }

  let urlsGuardadas = new Set();
  try {
    urlsGuardadas = await obtenerUrlsGuardadas();
    console.log(`💾 URLs ya existentes en Supabase cargadas: ${urlsGuardadas.size}`);
  } catch (error) {
    console.error(`❌ Error crítico obteniendo URLs guardadas de Supabase: ${error.message}`);
    console.error(`🛑 Deteniendo ejecución por seguridad para evitar duplicados.`);
    return;
  }

  const documentosNuevos = [];
  let pdfDuplicadosDescartados = 0;

  for (const [urlPdf, documento] of documentosTotales.entries()) {
    if (urlsGuardadas.has(urlPdf)) {
      pdfDuplicadosDescartados++;
    } else {
      documentosNuevos.push(documento);
    }
  }

  console.log(`🗑️ PDF duplicados descartados: ${pdfDuplicadosDescartados}`);
  console.log(`🆕 PDF nuevos pendientes de procesar: ${documentosNuevos.length}`);

  if (documentosNuevos.length === 0) {
    console.log("✅ No hay documentos nuevos.");
    return;
  }

  const analizados = [];
  let pdfOmitidosTamanio = 0;

  for (let indice = 0; indice < documentosNuevos.length; indice++) {
    const documento = documentosNuevos[indice];
    console.log(`📄 Analizando ${indice + 1}/${documentosNuevos.length}: ${documento.urlPdf}`);

    try {
      const texto = await extraerTextoPdf(documento.urlPdf);
      const tituloFinal = documento.tituloPagina || "Documento publicado en el BOJA";
      const sectores = detectarSectores(texto, tituloFinal);

      analizados.push({
        ...documento,
        texto,
        titulo: tituloFinal,
        sectores
      });
    } catch (error) {
      if (error.message.includes("35 MB")) {
        pdfOmitidosTamanio++;
      }
      console.log(`⚠️ PDF omitido ${documento.urlPdf}: ${error.message}`);
    }
  }

  console.log(`📏 PDF omitidos por superar tamaño: ${pdfOmitidosTamanio}`);

  if (analizados.length === 0) {
    console.log("ℹ️ No se pudo analizar ningún PDF.");
    return;
  }

  let documentosGuardados = [];

  try {
    const urlsActualizadas = await obtenerUrlsGuardadas();

    const realmenteNuevos = analizados.filter(
      documento => !urlsActualizadas.has(documento.urlPdf)
    );

    if (realmenteNuevos.length === 0) {
      console.log("ℹ️ Todos los documentos ya estaban guardados.");
      return;
    }

    await guardarAnuncios(realmenteNuevos);
    documentosGuardados = realmenteNuevos;

    console.log(
      `✅ Anuncios nuevos guardados en Supabase: ${documentosGuardados.length}`
    );
  } catch (error) {
    console.error(
      `❌ No se pudieron guardar los anuncios: ${error.message}`
    );
    console.error(
      "🛑 No se enviarán correos para evitar notificaciones duplicadas."
    );
    return;
  }

  const conCoincidencias = documentosGuardados.filter(
    documento => documento.sectores.length > 0
  );

  console.log(`🎯 Documentos con coincidencias de sectores: ${conCoincidencias.length}`);

  if (conCoincidencias.length === 0) {
    console.log("ℹ️ No hay coincidencias para notificar.");
    return;
  }

  let usuarios = [];
  try {
    usuarios = await obtenerUsuarios();
  } catch (error) {
    console.log(`⚠️ Error obteniendo usuarios de Supabase: ${error.message}`);
    return;
  }

  console.log(`👥 Usuarios cargados: ${usuarios.length}`);

  const notificaciones = [];

  for (const usuario of usuarios) {
  if (
    usuario.plan !== "premium" ||
    usuario.estado_suscripcion !== "activa" ||
    usuario.recibe_alertas !== true
  ) {
    console.log(
      `⛔ Usuario sin Premium activo omitido: ${usuario.email || "sin email"}`
    );
    continue;
  }

  if (
    !usuario.email ||
    !Array.isArray(usuario.sectores_suscritos) ||
    usuario.sectores_suscritos.length === 0
  ) {
    console.log(
      `⚠️ Usuario Premium sin email o sin sectores omitido: ${usuario.email || "sin email"}`
    );
    continue;
  }

  const sectoresUsuario = resolverSectoresUsuario(
    usuario.sectores_suscritos
  );

    if (sectoresUsuario.size === 0) {
      continue;
    }

    const relevantes = conCoincidencias
      .map((documento) => {
        const coincidenciasValidas = documento.sectores.filter((sector) =>
          sectoresUsuario.has(sector.sector)
        );
        if (coincidenciasValidas.length > 0) {
          return {
            ...documento,
            coincidencias: coincidenciasValidas
          };
        }
        return null;
      })
      .filter(Boolean);

    if (relevantes.length === 0) {
      continue;
    }

    try {
      console.log(`📧 Enviando correo a ${usuario.email}...`);
      await enviarCorreo(usuario.email, relevantes);

      for (const rel of relevantes) {
        notificaciones.push({
          usuario_id: usuario.id,
          mensaje: `Novedad BOJA: ${rel.titulo}`,
          leida: false
        });
      }
    } catch (error) {
      console.log(`❌ Error al enviar correo a ${usuario.email}: ${error.message}`);
    }
  }

  if (notificaciones.length > 0) {
    try {
      await guardarNotificaciones(notificaciones);
      console.log(`📊 Registro de notificaciones web guardado: ${notificaciones.length}`);
    } catch (error) {
      console.log(`⚠️ Error guardando registro de notificaciones: ${error.message}`);
    }
  }

  console.log("==================================================");
  console.log("🏁 PROCESO FINALIZADO CON ÉXITO");
  console.log("==================================================");
}

ejecutar().catch((error) => {
  console.error("❌ Error crítico en el proceso:", error);
  process.exit(1);
});
