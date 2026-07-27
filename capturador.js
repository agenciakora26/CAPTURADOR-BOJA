const cheerio = require("cheerio");
const pdfParse = require("pdf-parse");

/* =========================================================
   CONFIGURACIÓN
========================================================= */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const PORTADA_BOJA = "https://www.juntadeandalucia.es/eboja.html";

if (!SUPABASE_URL || !SUPABASE_KEY || !RESEND_API_KEY) {
  console.error(
    "Faltan SUPABASE_URL, SUPABASE_KEY o RESEND_API_KEY."
  );
  process.exit(1);
}

/*
 * Puedes añadir o quitar palabras.
 *
 * El nombre del sector debe coincidir exactamente con lo que
 * guardas en sectores_suscritos de Supabase.
 */

const PALABRAS_CLAVE = {
  oposiciones: [
    "oposición",
    "oposiciones",
    "concurso-oposición",
    "concurso oposición",
    "proceso selectivo",
    "procesos selectivos",
    "pruebas selectivas",
    "empleo público",
    "oferta de empleo público",
    "bolsa de empleo",
    "bolsa de trabajo",
    "acceso libre",
    "turno libre",
    "plazas vacantes",
    "personal funcionario",
    "personal laboral"
  ],

  subvenciones: [
    "subvención",
    "subvenciones",
    "ayuda",
    "ayudas",
    "incentivo",
    "incentivos",
    "beneficiarios",
    "beneficiarias",
    "concurrencia competitiva",
    "autónomos",
    "autónomas",
    "personas trabajadoras autónomas"
  ],

  sanidad: [
    "servicio andaluz de salud",
    "personal estatutario",
    "sanidad",
    "salud",
    "hospital",
    "hospitalario",
    "enfermería",
    "enfermero",
    "enfermera",
    "medicina",
    "médico",
    "médica",
    "atención primaria",
    "servicios sociales"
  ],

  educacion: [
    "educación",
    "universidad",
    "universidades",
    "personal docente",
    "profesorado",
    "maestro",
    "maestra",
    "beca",
    "becas",
    "centros educativos",
    "formación profesional"
  ],

  agricultura: [
    "agricultura",
    "agrícola",
    "ganadería",
    "ganadero",
    "ganadera",
    "pesca",
    "explotación agraria",
    "explotaciones agrarias",
    "desarrollo rural",
    "sector agrario"
  ],

  licitaciones: [
    "licitación",
    "licitaciones",
    "contratación pública",
    "contrato público",
    "contratos públicos",
    "adjudicación",
    "adjudicaciones",
    "obras públicas",
    "concurso público"
  ],

  hosteleria: [
    "hostelería",
    "hostelero",
    "hostelera",
    "turismo",
    "turístico",
    "turística",
    "comercio",
    "establecimientos turísticos",
    "alojamientos turísticos",
    "agencias de viajes"
  ],

  medioambiente: [
    "medio ambiente",
    "medioambiental",
    "sostenibilidad",
    "impacto ambiental",
    "evaluación ambiental",
    "residuos",
    "energías renovables",
    "energía solar",
    "protección ambiental"
  ]
};

/* =========================================================
   FUNCIONES AUXILIARES
========================================================= */

function normalizar(texto = "") {
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function escaparHtml(texto = "") {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function urlAbsoluta(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function fechaMadrid() {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date());
}

function nombreSector(sector) {
  const nombres = {
    oposiciones: "Oposiciones y Empleo Público",
    subvenciones: "Subvenciones y Autónomos",
    sanidad: "Sanidad y Servicios Sociales",
    educacion: "Educación y Universidades",
    agricultura: "Agricultura, Ganadería y Pesca",
    licitaciones: "Licitaciones y Obras Públicas",
    hosteleria: "Hostelería, Comercio y Turismo",
    medioambiente: "Medio Ambiente y Sostenibilidad"
  };

  return nombres[sector] || sector;
}

function iconoSector(sector) {
  const iconos = {
    oposiciones: "📢",
    subvenciones: "💶",
    sanidad: "🏥",
    educacion: "🎓",
    agricultura: "🚜",
    licitaciones: "🏗️",
    hosteleria: "🍽️",
    medioambiente: "🌿"
  };

  return iconos[sector] || "📌";
}

function detectarSectores(texto) {
  const textoNormalizado = normalizar(texto);
  const resultados = [];

  for (const [sector, palabras] of Object.entries(PALABRAS_CLAVE)) {
    const encontradas = palabras.filter((palabra) =>
      textoNormalizado.includes(normalizar(palabra))
    );

    if (encontradas.length > 0) {
      resultados.push({
        sector,
        palabrasEncontradas: [...new Set(encontradas)]
      });
    }
  }

  return resultados;
}

function obtenerExtracto(texto, palabras, longitud = 350) {
  const textoLimpio = String(texto || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!textoLimpio) {
    return "Publicación oficial relacionada con sus intereses.";
  }

  const textoNormalizado = normalizar(textoLimpio);

  let posicion = -1;

  for (const palabra of palabras) {
    posicion = textoNormalizado.indexOf(normalizar(palabra));

    if (posicion !== -1) break;
  }

  if (posicion === -1) {
    return textoLimpio.substring(0, longitud) + "...";
  }

  const inicio = Math.max(0, posicion - 100);
  const final = Math.min(
    textoLimpio.length,
    posicion + longitud
  );

  return `${inicio > 0 ? "..." : ""}${textoLimpio.substring(
    inicio,
    final
  )}${final < textoLimpio.length ? "..." : ""}`;
}

function obtenerTituloDesdePdf(texto) {
  const lineas = String(texto || "")
    .split("\n")
    .map((linea) => linea.replace(/\s+/g, " ").trim())
    .filter((linea) => linea.length > 25);

  const ignorar = [
    "boletín oficial de la junta de andalucía",
    "boja",
    "página",
    "depósito legal"
  ];

  const titulo = lineas.find((linea) => {
    const normalizada = normalizar(linea);

    return !ignorar.some((textoIgnorado) =>
      normalizada.startsWith(normalizar(textoIgnorado))
    );
  });

  return titulo
    ? titulo.substring(0, 500)
    : "Documento publicado en el BOJA";
}

/* =========================================================
   LOCALIZAR EL BOJA DEL DÍA
========================================================= */

async function obtenerBojaDeHoy() {
  console.log("Buscando el último BOJA publicado...");

  const respuesta = await fetch(PORTADA_BOJA, {
    headers: {
      "User-Agent": "BoletinHoy/1.0",
      Accept: "text/html"
    }
  });

  if (!respuesta.ok) {
    throw new Error(
      `No se pudo abrir la portada del BOJA: ${respuesta.status}`
    );
  }

  const html = await respuesta.text();
  const $ = cheerio.load(html);

  const anio = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    year: "numeric"
  }).format(new Date());

  const candidatos = new Map();

  $("a[href]").each((_, elemento) => {
    const href = $(elemento).attr("href");
    const url = urlAbsoluta(href, PORTADA_BOJA);

    if (!url) return;

    const coincidencia = url.match(
      new RegExp(
        `/eboja/${anio}/(\\d+)(?:/c\\d+)?(?:/index\\.html)?/?$`,
        "i"
      )
    );

    if (!coincidencia) return;

    const numero = Number(coincidencia[1]);

    candidatos.set(url, {
      url,
      numero
    });
  });

  const boletines = [...candidatos.values()].sort(
    (a, b) => b.numero - a.numero
  );

  if (boletines.length === 0) {
    console.log("No se encontró ningún boletín en la portada.");
    return null;
  }

  /*
   * Revisamos los primeros candidatos por si hay un boletín
   * extraordinario o más de una edición.
   */

  for (const candidato of boletines.slice(0, 5)) {
    const respuestaBoletin = await fetch(candidato.url, {
      headers: {
        "User-Agent": "BoletinHoy/1.0",
        Accept: "text/html"
      }
    });

    if (!respuestaBoletin.ok) continue;

    const contenido = await respuestaBoletin.text();

    if (contenido.includes(fechaMadrid())) {
      console.log(`BOJA de hoy encontrado: ${candidato.url}`);
      return candidato.url;
    }
  }

  console.log(
    `No se encontró un BOJA publicado hoy, ${fechaMadrid()}.`
  );

  return null;
}

/* =========================================================
   OBTENER SECCIONES Y PDF
========================================================= */

async function obtenerHtml(url) {
  const respuesta = await fetch(url, {
    headers: {
      "User-Agent": "BoletinHoy/1.0",
      Accept: "text/html"
    }
  });

  if (!respuesta.ok) {
    throw new Error(
      `No se pudo abrir ${url}: ${respuesta.status}`
    );
  }

  return respuesta.text();
}

async function obtenerPaginasBoletin(urlBoletin) {
  const html = await obtenerHtml(urlBoletin);
  const $ = cheerio.load(html);

  const base = urlBoletin.endsWith("/")
    ? urlBoletin
    : `${urlBoletin}/`;

  const paginas = new Set([urlBoletin]);

  $("a[href]").each((_, elemento) => {
    const href = $(elemento).attr("href");
    const url = urlAbsoluta(href, urlBoletin);

    if (!url || !url.startsWith(base)) return;

    if (/\/s\d+(?:\.html)?\/?$/i.test(url)) {
      paginas.add(url);
    }
  });

  return [...paginas];
}

async function obtenerPdfsPagina(urlPagina) {
  const html = await obtenerHtml(urlPagina);
  const $ = cheerio.load(html);

  const documentos = [];

  $("a[href]").each((_, elemento) => {
    const enlace = $(elemento);
    const textoEnlace = normalizar(enlace.text());
    const href = enlace.attr("href") || "";

    const esPdfOficial =
      textoEnlace.includes("pdf oficial autentico") ||
      /\.pdf(?:$|\?)/i.test(href);

    if (!esPdfOficial) return;

    const urlPdf = urlAbsoluta(href, urlPagina);

    if (!urlPdf) return;

    const textoPadre = normalizar(enlace.parent().text());

    if (
      textoPadre.includes("sumario boletin") ||
      textoPadre.includes("boletin completo")
    ) {
      return;
    }

    documentos.push({
      urlPdf
    });
  });

  return documentos;
}

async function obtenerTodosLosPdfs(urlBoletin) {
  const paginas = await obtenerPaginasBoletin(urlBoletin);

  console.log(`Secciones encontradas: ${paginas.length}`);

  const urls = new Set();

  for (const pagina of paginas) {
    try {
      const documentos = await obtenerPdfsPagina(pagina);

      for (const documento of documentos) {
        urls.add(documento.urlPdf);
      }
    } catch (error) {
      console.error(
        `Error leyendo la sección ${pagina}: ${error.message}`
      );
    }
  }

  console.log(`PDF oficiales encontrados: ${urls.size}`);

  return [...urls];
}

/* =========================================================
   DESCARGAR Y ANALIZAR PDF
========================================================= */

async function leerPdf(urlPdf) {
  const respuesta = await fetch(urlPdf, {
    headers: {
      "User-Agent": "BoletinHoy/1.0",
      Accept: "application/pdf"
    }
  });

  if (!respuesta.ok) {
    throw new Error(
      `No se pudo descargar el PDF: ${respuesta.status}`
    );
  }

  const buffer = Buffer.from(await respuesta.arrayBuffer());
  const resultado = await pdfParse(buffer);

  return resultado.text || "";
}

async function analizarPdfs(urlsPdf) {
  const resultados = [];

  for (let indice = 0; indice < urlsPdf.length; indice++) {
    const urlPdf = urlsPdf[indice];

    console.log(
      `Analizando PDF ${indice + 1} de ${urlsPdf.length}`
    );

    try {
      const textoCompleto = await leerPdf(urlPdf);
      const coincidencias = detectarSectores(textoCompleto);

      if (coincidencias.length === 0) continue;

      const titulo = obtenerTituloDesdePdf(textoCompleto);

      for (const coincidencia of coincidencias) {
        resultados.push({
          titulo,
          sector: coincidencia.sector,
          palabrasEncontradas:
            coincidencia.palabrasEncontradas,
          textoCompleto,
          urlRealExtraida: urlPdf
        });
      }

      console.log(
        `Coincidencia encontrada: ${titulo.substring(0, 80)}`
      );
    } catch (error) {
      console.error(
        `No se pudo analizar ${urlPdf}: ${error.message}`
      );
    }
  }

  return resultados;
}

/* =========================================================
   SUPABASE
========================================================= */

async function obtenerUsuarios() {
  const respuesta = await fetch(
    `${SUPABASE_URL}/rest/v1/perfiles_usuarios` +
      "?select=id,email,sectores_suscritos",
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );

  if (!respuesta.ok) {
    throw new Error(
      `Error obteniendo usuarios: ${await respuesta.text()}`
    );
  }

  return respuesta.json();
}

function mensajeNotificacion(documento) {
  return (
    `Nuevo documento en ${documento.sector.toUpperCase()}: ` +
    documento.titulo.substring(0, 300)
  );
}

/*
 * Comprueba si esta notificación ya existe.
 * Así no manda el mismo correo cada 15 minutos.
 */

async function notificacionYaExiste(usuarioId, documento) {
  const url = new URL(
    `${SUPABASE_URL}/rest/v1/notificaciones_web`
  );

  url.searchParams.set("select", "id");
  url.searchParams.set("usuario_id", `eq.${usuarioId}`);
  url.searchParams.set(
    "mensaje",
    `eq.${mensajeNotificacion(documento)}`
  );
  url.searchParams.set("limit", "1");

  const respuesta = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    }
  });

  if (!respuesta.ok) {
    console.error(
      "No se pudo comprobar si la notificación existía:",
      await respuesta.text()
    );

    return false;
  }

  const resultados = await respuesta.json();

  return resultados.length > 0;
}

async function crearNotificacion(usuarioId, documento) {
  const respuesta = await fetch(
    `${SUPABASE_URL}/rest/v1/notificaciones_web`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        usuario_id: usuarioId,
        mensaje: mensajeNotificacion(documento),
        leida: false
      })
    }
  );

  if (!respuesta.ok) {
    throw new Error(
      `Error creando notificación: ${await respuesta.text()}`
    );
  }
}

/* =========================================================
   CORREO
========================================================= */

function crearCorreo(documentos) {
  let html = `
    <div style="
      max-width:620px;
      margin:auto;
      padding:24px;
      background:#f4f7f6;
      font-family:Arial,sans-serif;
    ">
      <div style="
        background:#ffffff;
        padding:25px;
        border-radius:10px;
      ">
        <h1 style="
          margin:0;
          color:#006b4f;
          font-size:25px;
        ">
          BoletínHoy
        </h1>

        <p style="
          color:#64748b;
          margin-top:6px;
          font-size:14px;
        ">
          Alertas personalizadas del BOJA
        </p>

        <hr style="
          border:0;
          border-top:1px solid #e2e8f0;
          margin:20px 0;
        ">

        <p style="
          color:#334155;
          font-size:15px;
          line-height:1.5;
        ">
          Hemos encontrado nuevas publicaciones oficiales
          relacionadas con tus áreas de interés.
        </p>
  `;

  for (const documento of documentos) {
    const titulo = escaparHtml(documento.titulo);
    const sector = escaparHtml(
      nombreSector(documento.sector)
    );

    const palabras = documento.palabrasEncontradas
      .map(escaparHtml)
      .join(", ");

    const extracto = escaparHtml(
      obtenerExtracto(
        documento.textoCompleto,
        documento.palabrasEncontradas
      )
    );

    const urlPdf = escaparHtml(
      documento.urlRealExtraida
    );

    html += `
      <div style="
        margin-top:22px;
        padding:17px;
        background:#f8fafc;
        border-left:4px solid #008f6a;
        border-radius:5px;
      ">
        <p style="
          margin:0 0 8px;
          color:#0f172a;
          font-size:14px;
        ">
          ${iconoSector(documento.sector)}
          <strong>${sector}</strong>
        </p>

        <h2 style="
          margin:0 0 10px;
          color:#172033;
          font-size:16px;
          line-height:1.4;
        ">
          ${titulo}
        </h2>

        <p style="
          margin:0 0 10px;
          color:#475569;
          font-size:13px;
        ">
          Palabras encontradas:
          <strong>${palabras}</strong>
        </p>

        <p style="
          margin:0 0 15px;
          color:#64748b;
          font-size:13px;
          line-height:1.5;
        ">
          ${extracto}
        </p>

        <a
          href="${urlPdf}"
          target="_blank"
          rel="noopener noreferrer"
          style="
            display:inline-block;
            padding:10px 15px;
            background:#008f6a;
            color:#ffffff;
            border-radius:5px;
            text-decoration:none;
            font-size:13px;
            font-weight:bold;
          "
        >
          📄 Abrir PDF oficial exacto
        </a>
      </div>
    `;
  }

  html += `
        <p style="
          margin-top:25px;
          color:#94a3b8;
          font-size:11px;
          text-align:center;
        ">
          Mensaje automático de BoletínHoy.
        </p>
      </div>
    </div>
  `;

  return html;
}

async function enviarCorreo(email, documentos) {
  const respuesta = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "BoletínHoy <alertas@boletinhoy.es>",
        to: [email],
        subject:
          "🔔 Nuevas publicaciones del BOJA para ti",
        html: crearCorreo(documentos)
      })
    }
  );

  if (!respuesta.ok) {
    throw new Error(
      `Error enviando correo: ${await respuesta.text()}`
    );
  }
}

/* =========================================================
   PROCESO PRINCIPAL
========================================================= */

async function ejecutar() {
  try {
    console.log("====================================");
    console.log("INICIANDO CAPTURADOR BOJA");
    console.log(`Fecha: ${fechaMadrid()}`);
    console.log("====================================");

    const urlBoja = await obtenerBojaDeHoy();

    if (!urlBoja) {
      console.log("No hay un BOJA nuevo publicado hoy.");
      return;
    }

    const urlsPdf = await obtenerTodosLosPdfs(urlBoja);

    if (urlsPdf.length === 0) {
      console.log("No se encontraron PDF oficiales.");
      return;
    }

    const documentos = await analizarPdfs(urlsPdf);

    console.log(
      `Documentos relacionados encontrados: ${documentos.length}`
    );

    if (documentos.length === 0) {
      console.log("No se encontraron palabras clave.");
      return;
    }

    const usuarios = await obtenerUsuarios();

    console.log(`Usuarios encontrados: ${usuarios.length}`);

    for (const usuario of usuarios) {
      if (
        !usuario.email ||
        !Array.isArray(usuario.sectores_suscritos) ||
        usuario.sectores_suscritos.length === 0
      ) {
        continue;
      }

      const sectoresUsuario =
        usuario.sectores_suscritos.map(normalizar);

      const documentosDelUsuario = documentos.filter(
        (documento) =>
          sectoresUsuario.includes(
            normalizar(documento.sector)
          )
      );

      const documentosNuevos = [];

      for (const documento of documentosDelUsuario) {
        const yaExiste = await notificacionYaExiste(
          usuario.id,
          documento
        );

        if (!yaExiste) {
          documentosNuevos.push(documento);
        }
      }

      if (documentosNuevos.length === 0) {
        console.log(
          `Sin documentos nuevos para ${usuario.email}`
        );
        continue;
      }

      try {
        await enviarCorreo(
          usuario.email,
          documentosNuevos
        );

        console.log(
          `Correo enviado a ${usuario.email}`
        );

        for (const documento of documentosNuevos) {
          await crearNotificacion(
            usuario.id,
            documento
          );
        }
      } catch (error) {
        console.error(
          `Error procesando a ${usuario.email}:`,
          error.message
        );
      }
    }

    console.log("====================================");
    console.log("PROCESO FINALIZADO");
    console.log("====================================");
  } catch (error) {
    console.error("ERROR GENERAL:", error);
    process.exitCode = 1;
  }
}

ejecutar();
