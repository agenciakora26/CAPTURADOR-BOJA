const cheerio = require("cheerio");
const pdfParse = require("pdf-parse");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "")
  .replace(/\/rest\/v1\/?$/i, "")
  .replace(/\/+$/, "");

const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const BASE_BOJA = "https://www.juntadeandalucia.es/eboja";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0; +https://boletinhoy.es)";

if (!SUPABASE_URL || !SUPABASE_KEY || !RESEND_API_KEY) {
  console.error("❌ Faltan SUPABASE_URL, SUPABASE_KEY o RESEND_API_KEY.");
  process.exit(1);
}

const SECTORES = {
  "oposiciones y empleo público": {
    palabras: {
      "oposicion": 3, "oposiciones": 3, "concurso-oposicion": 3, "concurso oposicion": 3,
      "proceso selectivo": 3, "procesos selectivos": 3, "pruebas selectivas": 3,
      "empleo publico": 3, "oferta de empleo publico": 3, "bolsa de empleo": 2,
      "bolsa de trabajo": 2, "turno libre": 2, "acceso libre": 2, "plazas vacantes": 2,
      "personal funcionario": 2, "personal laboral": 2, "personal estatutario": 2,
      "funcionario de carrera": 3, "nombramiento": 2, "toma de posesion": 2
    },
    umbral: 3
  },
  "subvenciones y ayudas": {
    palabras: {
      "subvencion": 3, "subvenciones": 3, "ayuda": 2, "ayudas": 2, "bases reguladoras": 3,
      "concesion de subvenciones": 3, "ayudas directas": 3, "incentivo": 2, "incentivos": 2,
      "beneficiarios": 1, "beneficiarias": 1, "concurrencia competitiva": 3,
      "concurrencia no competitiva": 3, "extracto de la resolucion": 3, "plazo de solicitud": 2,
      "personas trabajadoras autonomas": 3, "autonomos": 2, "autonomas": 2
    },
    umbral: 3
  },
  "agricultura y pesca": {
    palabras: {
      "agricultura": 3, "agricola": 2, "pesca": 3, "pesquero": 2, "pesquera": 2,
      "ganaderia": 3, "ganadero": 2, "ganadera": 2, "politica agraria comun": 3,
      "explotacion agraria": 3, "explotaciones agrarias": 3, "desarrollo rural": 2,
      "sector agrario": 2, "sector pesquero": 2, "produccion agricola": 2,
      "sanidad animal": 2, "acuicultura": 3
    },
    umbral: 3
  },
  "hostelería y comercio": {
    palabras: {
      "hosteleria": 3, "hostelero": 2, "hostelera": 2, "comercio": 2, "turismo": 3,
      "turistico": 2, "turistica": 2, "restauracion": 2, "establecimientos turisticos": 3,
      "alojamientos turisticos": 3, "hoteles": 2, "agencias de viajes": 2,
      "comercio interior": 2, "artesania": 2, "mercados de abastos": 2
    },
    umbral: 3
  },
  "licitaciones y contratación": {
    palabras: {
      "licitacion": 3, "licitaciones": 3, "contratacion publica": 3, "contrato publico": 3,
      "contrato menor": 2, "mesa de contratacion": 3, "pliego de clausulas administrativas": 3,
      "adjudicacion": 2, "adjudicaciones": 2, "formalizacion de contrato": 3,
      "procedimiento abierto": 2, "acuerdo marco": 2, "obras publicas": 2, "concurso publico": 3
    },
    umbral: 3
  },
  "sanidad y servicios sociales": {
    palabras: {
      "servicio andaluz de salud": 4, "personal estatutario": 2, "sanidad": 3,
      "salud": 1, "hospital": 2, "hospitalario": 2, "enfermeria": 3, "enfermero": 2,
      "enfermera": 2, "medicina": 2, "medico": 2, "medica": 2, "atencion primaria": 3,
      "servicios sociales": 3, "dependencia": 2
    },
    umbral: 3
  },
  "educación y universidades": {
    palabras: {
      "educacion": 3, "universidad": 3, "universidades": 3, "personal docente": 3,
      "profesorado": 3, "maestro": 2, "maestra": 2, "beca": 2, "becas": 2,
      "centros educativos": 2, "formacion profesional": 3, "cuerpos docentes universitarios": 3
    },
    umbral: 3
  },
  "medio ambiente y sostenibilidad": {
    palabras: {
      "medio ambiente": 3, "medioambiental": 3, "sostenibilidad": 3, "impacto ambiental": 3,
      "evaluacion ambiental": 3, "residuos": 2, "energias renovables": 3,
      "energia solar": 2, "proteccion ambiental": 2, "calidad ambiental": 2
    },
    umbral: 3
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

function urlCanonica(url) {
  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname.replace(/\/index\.html$/i, "/");
    if (!pathname.endsWith("/")) {
      pathname += "/";
    }
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return null;
  }
}

function urlAbsoluta(href, base) {
  try {
    const absoluta = new URL(href, base).href;
    return urlCanonica(absoluta);
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
    const d = new Date(ahora);
    d.setDate(ahora.getDate() - i);
    const anio = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    fechas.push({
      anio: String(anio),
      formatoFecha: `${anio}${mes}${dia}`
    });
  }
  return fechas;
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
      const $ = cheerio.load(html);
      const textoBody = normalizar($("body").text());

      if (textoBody.length > 100 && (textoBody.includes("boletin oficial") || textoBody.includes("boja"))) {
        const canonicalBase = urlCanonica(respuesta.url);
        if (canonicalBase && !urlsProcesadas.has(canonicalBase)) {
          urlsProcesadas.add(canonicalBase);
          publicacionesValidas.push({
            url: canonicalBase,
            html,
            anio: item.anio
          });
        }

        $("a[href]").each((_, el) => {
          const href = $(el).attr("href");
          const absoluta = urlAbsoluta(href, respuesta.url);
          if (!absoluta) return;

          // Regex estricta para asegurar formato /YYYY/NNN/ o /YYYY/NNN/cXX/ sin fusionar números
          const matchBoja = absoluta.match(/\/eboja\/(\d{4})\/(\d+)\/(?:(c\d{2})\/)?$/i);
          if (matchBoja) {
            const canon = urlCanonica(absoluta);
            if (canon && !urlsProcesadas.has(canon)) {
              urlsProcesadas.add(canon);
              publicacionesValidas.push({
                url: canon,
                html: "", // Se descargará si es necesario
                anio: matchBoja[1]
              });
            }
          }
        });
      }
    } catch {
      // Ignora errores individuales de fechas que no existan
    }
  }

  return publicacionesValidas;
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

    // Aceptar únicamente páginas de sección del tipo sXX.html o rutas internas válidas sin alterar números
    const limpia = absoluta.split("#")[0].split("?")[0];
    if (/\/(?:s\d+(?:\.html)?|\bindex\.html)?$/i.test(limpia)) {
      paginas.add(limpia);
    }
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

    // Regex estricta para validar que sea un enlace a PDF del BOJA válido
    const esPdfValido = /\.pdf(?:$|[?#])/i.test(href) || textoEnlace.includes("pdf oficial autentico");
    if (!esPdfValido) {
      return;
    }

    const urlPdf = urlAbsoluta(href, respuesta.url);
    if (!urlPdf) {
      return;
    }

    const contexto = normalizar(enlace.closest("li,article,div").text());
    if (contexto.includes("boletin completo") || contexto.includes("sumario boletin")) {
      return;
    }

    documentos.set(urlPdf, {
      urlPdf,
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
  const buffer = Buffer.from(await respuesta.arrayBuffer());

  if (buffer.length > 35 * 1024 * 1024) {
    throw new Error("El PDF supera los 35 MB.");
  }

  const resultado = await pdfParse(buffer);
  return String(resultado.text || "").replace(/\u0000/g, " ");
}

function detectarSectores(texto) {
  const textoNormalizado = normalizar(texto);
  const coincidencias = [];

  for (const [sector, configuracion] of Object.entries(SECTORES)) {
    let puntuacionTotal = 0;
    const palabrasEncontradasSet = new Set();

    for (const [palabraClave, peso] of Object.entries(configuracion.palabras)) {
      const palabraNorm = normalizar(palabraClave);
      if (palabraNorm.length <= 2) {
        const regex = new RegExp(`\\b${palabraNorm}\\b`, "i");
        if (regex.test(textoNormalizado)) {
          puntuacionTotal += peso;
          palabrasEncontradasSet.add(palabraClave);
        }
      } else {
        if (textoNormalizado.includes(palabraNorm)) {
          puntuacionTotal += peso;
          palabrasEncontradasSet.add(palabraClave);
        }
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
    throw new Error(`Supabase ${respuesta.status}: ${await respuesta.text()}`);
  }

  if (respuesta.status === 204) {
    return null;
  }

  const texto = await respuesta.text();
  return texto ? JSON.parse(texto) : null;
}

async function obtenerUrlsGuardadas() {
  const filas = (await supabaseRequest("anuncios_boja?select=url_pdf")) || [];
  return new Set(filas.map((fila) => fila.url_pdf).filter(Boolean));
}

async function obtenerUsuarios() {
  return (await supabaseRequest("perfiles_usuarios?select=id,email,sectores_suscritos")) || [];
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

  await supabaseRequest("anuncios_boja", {
    method: "POST",
    headers: {
      Prefer: "return=minimal"
    },
    body: JSON.stringify(filas)
  });
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

  console.log(`📚 Publicaciones encontradas: ${publicaciones.length}`);

  const documentosTotales = new Map();

  for (const publicacion of publicaciones) {
    console.log(`🔍 Revisando ${publicacion.url}`);
    try {
      const documentos = await obtenerDocumentosPublicacion(publicacion);
      console.log(`   PDF localizados: ${documentos.length}`);
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
  } catch (error) {
    console.log(`⚠️ Error obteniendo URLs guardadas de Supabase: ${error.message}`);
  }

  const documentosNuevos = [...documentosTotales.values()].filter(
    (documento) => !urlsGuardadas.has(documento.urlPdf)
  );

  console.log(`🆕 PDF nuevos: ${documentosNuevos.length}`);

  if (documentosNuevos.length === 0) {
    console.log("✅ No hay documentos nuevos.");
    return;
  }

  const analizados = [];

  for (let indice = 0; indice < documentosNuevos.length; indice++) {
    const documento = documentosNuevos[indice];
    console.log(`📄 Analizando ${indice + 1}/${documentosNuevos.length}`);

    try {
      const texto = await extraerTextoPdf(documento.urlPdf);
      const sectores = detectarSectores(texto);

      analizados.push({
        ...documento,
        texto,
        titulo: documento.tituloPagina || "Documento publicado en el BOJA",
        sectores
      });
    } catch (error) {
      console.log(`⚠️ PDF omitido ${documento.urlPdf}: ${error.message}`);
    }
  }

  if (analizados.length === 0) {
    console.log("ℹ️ No se pudo analizar ningún PDF.");
    return;
  }

  try {
    await guardarAnuncios(analizados);
    console.log(`✅ Anuncios guardados: ${analizados.length}`);
  } catch (error) {
    console.log(`⚠️ Error guardando anuncios en Supabase: ${error.message}`);
  }

  const conCoincidencias = analizados.filter(
    (documento) => documento.sectores.length > 0
  );

  console.log(`🎯 Documentos con coincidencias: ${conCoincidencias.length}`);

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
      !usuario.email ||
      !Array.isArray(usuario.sectores_suscritos) ||
      usuario.sectores_suscritos.length === 0
    ) {
      continue;
    }

    const sectoresUsuario = resolverSectoresUsuario(usuario.sectores_suscritos);

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

      notificaciones.push({
        usuario_id: usuario.id,
        email: usuario.email,
        estado: "enviado",
        total_documentos: relevantes.length
      });
    } catch (error) {
      console.log(`❌ Error al enviar correo a ${usuario.email}: ${error.message}`);

      notificaciones.push({
        usuario_id: usuario.id,
        email: usuario.email,
        estado: "error",
        error: error.message
      });
    }
  }

  if (notificaciones.length > 0) {
    try {
      await guardarNotificaciones(notificaciones);
      console.log(`📊 Registro de notificaciones guardado: ${notificaciones.length}`);
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
