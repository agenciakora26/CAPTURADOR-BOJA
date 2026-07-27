const cheerio = require("cheerio");
const pdfParse = require("pdf-parse");

/* =========================================================
   CONFIGURACIÓN
========================================================= */

const SUPABASE_URL = String(process.env.SUPABASE_URL || "")
  .replace(/\/rest\/v1\/?$/i, "")
  .replace(/\/+$/, "");

const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

const PORTADA_BOJA =
  "https://www.juntadeandalucia.es/eboja.html";

const RSS_BOJA =
  "https://www.juntadeandalucia.es/boja/distribucion/s51.xml";

const BASE_BOJA =
  "https://www.juntadeandalucia.es/eboja";

const USER_AGENT =
  "Mozilla/5.0 (compatible; BoletinHoy/1.0; +https://boletinhoy.es)";

if (
  !SUPABASE_URL ||
  !SUPABASE_KEY ||
  !RESEND_API_KEY
) {
  console.error(
    "❌ Faltan SUPABASE_URL, SUPABASE_KEY o RESEND_API_KEY."
  );

  process.exit(1);
}

/* =========================================================
   PALABRAS CLAVE
========================================================= */

const SECTORES = {
  "oposiciones y empleo público": [
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
    "turno libre",
    "acceso libre",
    "plazas vacantes",
    "personal funcionario",
    "personal laboral",
    "personal estatutario",
    "funcionario de carrera",
    "nombramiento",
    "toma de posesión"
  ],

  "subvenciones y ayudas": [
    "subvención",
    "subvenciones",
    "ayuda",
    "ayudas",
    "bases reguladoras",
    "concesión de subvenciones",
    "ayudas directas",
    "incentivo",
    "incentivos",
    "beneficiarios",
    "beneficiarias",
    "concurrencia competitiva",
    "concurrencia no competitiva",
    "extracto de la resolución",
    "plazo de solicitud",
    "personas trabajadoras autónomas",
    "autónomos",
    "autónomas"
  ],

  "agricultura y pesca": [
    "agricultura",
    "agrícola",
    "pesca",
    "pesquero",
    "pesquera",
    "ganadería",
    "ganadero",
    "ganadera",
    "política agraria común",
    "explotación agraria",
    "explotaciones agrarias",
    "desarrollo rural",
    "sector agrario",
    "sector pesquero",
    "producción agrícola",
    "sanidad animal",
    "acuicultura"
  ],

  "hostelería y comercio": [
    "hostelería",
    "hostelero",
    "hostelera",
    "comercio",
    "turismo",
    "turístico",
    "turística",
    "restauración",
    "establecimientos turísticos",
    "alojamientos turísticos",
    "hoteles",
    "agencias de viajes",
    "comercio interior",
    "artesanía",
    "mercados de abastos"
  ],

  "licitaciones y contratación": [
    "licitación",
    "licitaciones",
    "contratación pública",
    "contrato público",
    "contrato menor",
    "mesa de contratación",
    "pliego de cláusulas administrativas",
    "adjudicación",
    "adjudicaciones",
    "formalización de contrato",
    "procedimiento abierto",
    "acuerdo marco",
    "obras públicas",
    "concurso público"
  ],

  "sanidad y servicios sociales": [
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
    "servicios sociales",
    "dependencia"
  ],

  "educación y universidades": [
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
    "formación profesional",
    "cuerpos docentes universitarios"
  ],

  "medio ambiente y sostenibilidad": [
    "medio ambiente",
    "medioambiental",
    "sostenibilidad",
    "impacto ambiental",
    "evaluación ambiental",
    "residuos",
    "energías renovables",
    "energía solar",
    "protección ambiental",
    "calidad ambiental"
  ]
};

/* =========================================================
   UTILIDADES
========================================================= */

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

function urlAbsoluta(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

async function descargar(
  url,
  accept = "*/*"
) {
  const respuesta = await fetch(url, {
    redirect: "follow",

    signal:
      AbortSignal.timeout(45000),

    headers: {
      "User-Agent": USER_AGENT,
      Accept: accept,
      "Accept-Language":
        "es-ES,es;q=0.9"
    }
  });

  if (!respuesta.ok) {
    throw new Error(
      `HTTP ${respuesta.status} al consultar ${url}`
    );
  }

  return respuesta;
}

/* =========================================================
   DESCUBRIMIENTO ROBUSTO DE PUBLICACIONES DEL BOJA

   IMPORTANTE:
   La Junta utiliza dos tipos de identificadores:

   - Número normal:
     /eboja/2026/143/

   - Identificador interno de complementarios:
     /eboja/2026/214302/

   Ambos son válidos. El identificador se conserva exactamente
   como aparece en la web oficial. Nunca se recorta ni se modifica.
========================================================= */

function interpretarUrlPublicacion(enlace, base = PORTADA_BOJA) {
  let url;

  try {
    url = new URL(enlace, base);
  } catch {
    return null;
  }

  if (
    url.hostname !== "www.juntadeandalucia.es" &&
    url.hostname !== "juntadeandalucia.es"
  ) {
    return null;
  }

  const pathname = url.pathname
    .replace(/\/index\.html$/i, "/")
    .replace(/\/+$/, "/");

  /*
   * Solo acepta páginas principales de boletines:
   *
   * /eboja/2026/143/
   * /eboja/2026/214302/
   *
   * Rechaza disposiciones individuales:
   *
   * /eboja/2026/143/61
   * /eboja/2026/143/61-verificacion
   * /eboja/2026/143/s53.html
   */

  const coincidencia = pathname.match(
    /^\/eboja\/(\d{4})\/(\d{1,9})\/$/i
  );

  if (!coincidencia) {
    return null;
  }

  const anio = coincidencia[1];
  const identificador = coincidencia[2];

  return {
    anio,
    identificador,
    url: `${BASE_BOJA}/${anio}/${identificador}/`
  };
}

function registrarPublicacion(
  mapa,
  enlace,
  base = PORTADA_BOJA
) {
  const publicacion = interpretarUrlPublicacion(
    enlace,
    base
  );

  if (!publicacion) {
    return;
  }

  mapa.set(
    publicacion.url,
    publicacion
  );
}

function ordenarPublicaciones(a, b) {
  if (Number(a.anio) !== Number(b.anio)) {
    return Number(b.anio) - Number(a.anio);
  }

  return (
    Number(b.identificador) -
    Number(a.identificador)
  );
}

async function candidatosDesdePortada() {
  console.log(
    "🔎 Consultando la portada oficial del BOJA..."
  );

  const respuesta = await descargar(
    PORTADA_BOJA,
    "text/html"
  );

  const html = await respuesta.text();
  const $ = cheerio.load(html);
  const mapa = new Map();

  /*
   * Primero utilizamos los enlaces reales de la portada.
   */

  $("a[href]").each((_, elemento) => {
    const enlace = $(elemento);
    const href = enlace.attr("href");

    const textoContexto = normalizar(
      [
        enlace.text(),
        enlace.parent().text(),
        enlace.closest("article").text(),
        enlace.closest("li").text(),
        enlace.closest("div").text()
      ].join(" ")
    );

    /*
     * Para evitar enlaces irrelevantes, damos prioridad
     * a los que aparecen cerca de las palabras BOJA o boletín.
     */

    if (
      textoContexto.includes("boja") ||
      textoContexto.includes("boletin") ||
      /\/eboja\/\d{4}\/\d+\/?(?:index\.html)?$/i.test(
        href || ""
      )
    ) {
      registrarPublicacion(
        mapa,
        href,
        respuesta.url
      );
    }
  });

  /*
   * Como respaldo, localizamos rutas completas dentro del HTML.
   * El identificador puede tener más de cuatro cifras.
   */

  const expresiones = [
    /https?:\/\/(?:www\.)?juntadeandalucia\.es\/eboja\/\d{4}\/\d{1,9}\/(?:index\.html)?/gi,
    /\/eboja\/\d{4}\/\d{1,9}\/(?:index\.html)?/gi
  ];

  for (const expresion of expresiones) {
    const coincidencias = html.match(expresion) || [];

    for (const coincidencia of coincidencias) {
      registrarPublicacion(
        mapa,
        coincidencia,
        respuesta.url
      );
    }
  }

  const resultado = [...mapa.values()].sort(
    ordenarPublicaciones
  );

  console.log(
    `   Candidatos obtenidos de portada: ${resultado.length}`
  );

  return resultado;
}

async function candidatosDesdeRss() {
  console.log(
    "🔎 Consultando el RSS oficial como respaldo..."
  );

  const respuesta = await descargar(
    RSS_BOJA,
    "application/xml,text/xml"
  );

  const xml = await respuesta.text();
  const $ = cheerio.load(xml, {
    xmlMode: true
  });

  const mapa = new Map();

  $("entry,item").each((_, elemento) => {
    const entrada = $(elemento);

    const contenido = [
      entrada
        .find("link[href]")
        .first()
        .attr("href"),

      entrada
        .find("link")
        .first()
        .text(),

      entrada
        .find("guid")
        .first()
        .text(),

      entrada.text()
    ]
      .filter(Boolean)
      .join(" ");

    /*
     * Extraemos primero cualquier URL del BOJA.
     */

    const urls = contenido.match(
      /https?:\/\/(?:www\.)?juntadeandalucia\.es\/eboja\/\d{4}\/\d{1,9}(?:\/[^\s<>"']*)?/gi
    ) || [];

    for (const enlace of urls) {
      let url;

      try {
        url = new URL(enlace);
      } catch {
        continue;
      }

      const partes = url.pathname
        .split("/")
        .filter(Boolean);

      const posicionEboja = partes.findIndex(
        (parte) =>
          parte.toLowerCase() === "eboja"
      );

      if (posicionEboja < 0) {
        continue;
      }

      const anio = partes[posicionEboja + 1];
      const identificador =
        partes[posicionEboja + 2];

      if (
        !/^\d{4}$/.test(anio || "") ||
        !/^\d{1,9}$/.test(
          identificador || ""
        )
      ) {
        continue;
      }

      /*
       * Aunque el RSS enlace una disposición individual,
       * construimos únicamente la raíz de esa publicación.
       */

      registrarPublicacion(
        mapa,
        `${BASE_BOJA}/${anio}/${identificador}/`
      );
    }
  });

  const resultado = [...mapa.values()].sort(
    ordenarPublicaciones
  );

  console.log(
    `   Candidatos obtenidos del RSS: ${resultado.length}`
  );

  return resultado;
}

async function validarPublicacion(publicacion) {
  const urlsPrueba = [
    publicacion.url,
    `${publicacion.url}index.html`
  ];

  for (const url of urlsPrueba) {
    try {
      const respuesta = await descargar(
        url,
        "text/html"
      );

      const html = await respuesta.text();
      const $ = cheerio.load(html);

      const texto = normalizar(
        $("body").text()
      );

      /*
       * Una publicación válida debe tener contenido BOJA
       * y alguna estructura propia de un boletín:
       * PDF, secciones o sumario.
       */

      const tieneIdentidadBoja =
        texto.includes(
          "boletin oficial de la junta de andalucia"
        ) ||
        texto.includes(
          "sede electronica del boja"
        ) ||
        texto.includes(
          "boletin numero"
        ) ||
        texto.includes("boja num");

      const tieneContenidoBoja =
        $("a[href*='.pdf']").length > 0 ||
        $("a[href*='/s']").length > 0 ||
        texto.includes(
          "pdf oficial autentico"
        ) ||
        texto.includes(
          "sumario boletin"
        );

      if (
        !tieneIdentidadBoja ||
        !tieneContenidoBoja
      ) {
        console.log(
          `   Rechazada ${url}: no parece una publicación completa del BOJA`
        );

        continue;
      }

      /*
       * Intentamos obtener el número público real.
       *
       * Ejemplo:
       * Identificador interno: 214302
       * Número público: 143 Complementario 2
       */

      const numeroPublicoMatch =
        texto.match(
          /boletin numero\s+(\d+)/i
        ) ||
        texto.match(
          /boja num\.?\s*(\d+)/i
        ) ||
        texto.match(
          /boja numero\s+(\d+)/i
        );

      const complementoMatch =
        texto.match(
          /complementario(?:\s+num\.?|\s+numero)?\s*(\d+)/i
        );

      return {
        ...publicacion,

        url:
          publicacion.url,

        html,

        numeroPublico:
          numeroPublicoMatch
            ? Number(
                numeroPublicoMatch[1]
              )
            : null,

        complemento:
          complementoMatch
            ? Number(
                complementoMatch[1]
              )
            : null
      };
    } catch (error) {
      console.log(
        `   No válida ${url}: ${error.message}`
      );
    }
  }

  return null;
}

async function descubrirEnlacesRelacionados(
  publicacion
) {
  const mapa = new Map();

  mapa.set(
    publicacion.url,
    publicacion
  );

  const $ = cheerio.load(
    publicacion.html || ""
  );

  /*
   * Conservamos exactamente los enlaces que ofrece
   * la página oficial. No intentamos inventar el ID
   * de los complementarios.
   */

  $("a[href]").each((_, elemento) => {
    const href = $(elemento).attr("href");

    const descubierta =
      interpretarUrlPublicacion(
        href,
        publicacion.url
      );

    if (!descubierta) {
      return;
    }

    if (
      descubierta.anio !==
      publicacion.anio
    ) {
      return;
    }

    mapa.set(
      descubierta.url,
      descubierta
    );
  });

  /*
   * Si conocemos el número público real, añadimos también
   * la ruta normal. Esto permite que, cuando la portada
   * muestre un complementario, también se revise el boletín
   * ordinario correspondiente.
   */

  if (
    publicacion.numeroPublico &&
    Number.isInteger(
      publicacion.numeroPublico
    )
  ) {
    registrarPublicacion(
      mapa,
      `${BASE_BOJA}/${publicacion.anio}/${publicacion.numeroPublico}/`
    );
  }

  return [...mapa.values()];
}

async function descubrirPublicaciones() {
  const candidatos = new Map();

  try {
    const portada =
      await candidatosDesdePortada();

    for (const publicacion of portada) {
      candidatos.set(
        publicacion.url,
        publicacion
      );
    }
  } catch (error) {
    console.log(
      `⚠️ No se pudo consultar la portada: ${error.message}`
    );
  }

  try {
    const rss =
      await candidatosDesdeRss();

    for (const publicacion of rss) {
      candidatos.set(
        publicacion.url,
        publicacion
      );
    }
  } catch (error) {
    console.log(
      `⚠️ No se pudo consultar el RSS: ${error.message}`
    );
  }

  /*
   * Revisamos un máximo razonable para evitar recorrer
   * accidentalmente todo el histórico.
   */

  const candidatosOrdenados = [
    ...candidatos.values()
  ]
    .sort(ordenarPublicaciones)
    .slice(0, 30);

  console.log(
    `📚 Candidatos encontrados: ${candidatosOrdenados.length}`
  );

  const validadas = new Map();

  for (const candidato of candidatosOrdenados) {
    const validada =
      await validarPublicacion(
        candidato
      );

    if (!validada) {
      continue;
    }

    validadas.set(
      validada.url,
      validada
    );

    const relacionadas =
      await descubrirEnlacesRelacionados(
        validada
      );

    for (const relacionada of relacionadas) {
      if (
        !validadas.has(
          relacionada.url
        )
      ) {
        validadas.set(
          relacionada.url,
          relacionada
        );
      }
    }
  }

  /*
   * Validamos también las publicaciones descubiertas
   * desde otras páginas.
   */

  const resultado = [];

  for (
    const publicacion of [
      ...validadas.values()
    ].sort(ordenarPublicaciones)
  ) {
    if (publicacion.html) {
      resultado.push(publicacion);
      continue;
    }

    const validada =
      await validarPublicacion(
        publicacion
      );

    if (validada) {
      resultado.push(validada);
    }
  }

  /*
   * Eliminación final de duplicados.
   */

  return [
    ...new Map(
      resultado.map(
        (publicacion) => [
          publicacion.url,
          publicacion
        ]
      )
    ).values()
  ];
}
/* =========================================================
   EXTRAER PDF DE CADA PUBLICACIÓN
========================================================= */

async function obtenerPaginasSecciones(
  publicacion
) {
  const respuesta =
    await descargar(
      publicacion.url,
      "text/html"
    );

  const html =
    await respuesta.text();

  const $ =
    cheerio.load(html);

  const paginas =
    new Set([
      publicacion.url
    ]);

  $("a[href]").each(
    (_, elemento) => {
      const absoluta =
        urlAbsoluta(
          $(elemento).attr("href"),
          respuesta.url
        );

      if (!absoluta) {
        return;
      }

      if (
        !absoluta.startsWith(
          publicacion.url
        )
      ) {
        return;
      }

      const limpia =
        absoluta
          .split("#")[0]
          .split("?")[0];

      if (
        /\/s\d+(?:\.html)?$/i.test(
          limpia
        )
      ) {
        paginas.add(limpia);
      }
    }
  );

  return [
    ...paginas
  ];
}

function obtenerTituloCercano(
  $,
  elemento
) {
  const enlace =
    $(elemento);

  const candidatos = [
    enlace
      .closest("li")
      .text(),

    enlace
      .closest("article")
      .text(),

    enlace
      .closest(".item")
      .text(),

    enlace
      .closest("div")
      .text(),

    enlace
      .parent()
      .text()
  ];

  for (
    const candidato
    of candidatos
  ) {
    const limpio =
      String(candidato || "")
        .replace(
          /PDF oficial auténtico/gi,
          ""
        )
        .replace(
          /Otros formatos/gi,
          ""
        )
        .replace(
          /Verificar autenticidad/gi,
          ""
        )
        .replace(/\s+/g, " ")
        .trim();

    if (
      limpio.length >= 25
    ) {
      return limpio.substring(
        0,
        1000
      );
    }
  }

  return (
    "Documento publicado en el BOJA"
  );
}

async function obtenerDocumentosPagina(
  urlPagina
) {
  const respuesta =
    await descargar(
      urlPagina,
      "text/html"
    );

  const html =
    await respuesta.text();

  const $ =
    cheerio.load(html);

  const documentos =
    new Map();

  $("a[href]").each(
    (_, elemento) => {
      const enlace =
        $(elemento);

      const href =
        enlace.attr("href") || "";

      const textoEnlace =
        normalizar(
          enlace.text()
        );

      const parecePdf =
        /\.pdf(?:$|[?#])/i.test(
          href
        ) ||
        textoEnlace.includes(
          "pdf oficial autentico"
        );

      if (!parecePdf) {
        return;
      }

      const urlPdf =
        urlAbsoluta(
          href,
          respuesta.url
        );

      if (!urlPdf) {
        return;
      }

      const contexto =
        normalizar(
          enlace
            .closest(
              "li,article,div"
            )
            .text()
        );

      if (
        contexto.includes(
          "boletin completo"
        ) ||
        contexto.includes(
          "sumario boletin"
        )
      ) {
        return;
      }

      documentos.set(
        urlPdf,
        {
          urlPdf,

          tituloPagina:
            obtenerTituloCercano(
              $,
              elemento
            ),

          urlSeccion:
            respuesta.url
        }
      );
    }
  );

  return [
    ...documentos.values()
  ];
}

async function obtenerDocumentosPublicacion(
  publicacion
) {
  const paginas =
    await obtenerPaginasSecciones(
      publicacion
    );

  console.log(
    `   Secciones de ${publicacion.url}: ${paginas.length}`
  );

  const mapa =
    new Map();

  for (
    const pagina of paginas
  ) {
    try {
      const documentos =
        await obtenerDocumentosPagina(
          pagina
        );

      for (
        const documento
        of documentos
      ) {
        mapa.set(
          documento.urlPdf,
          documento
        );
      }
    } catch (error) {
      console.log(
        `⚠️ Página omitida ${pagina}: ${error.message}`
      );
    }
  }

  return [
    ...mapa.values()
  ];
}

/* =========================================================
   ANALIZAR PDF
========================================================= */

async function extraerTextoPdf(
  urlPdf
) {
  const respuesta =
    await descargar(
      urlPdf,
      "application/pdf"
    );

  const buffer =
    Buffer.from(
      await respuesta.arrayBuffer()
    );

  if (
    buffer.length >
    35 * 1024 * 1024
  ) {
    throw new Error(
      "El PDF supera los 35 MB."
    );
  }

  const resultado =
    await pdfParse(buffer);

  return String(
    resultado.text || ""
  ).replace(/\u0000/g, " ");
}

function detectarSectores(
  texto
) {
  const textoNormalizado =
    normalizar(texto);

  const coincidencias = [];

  for (
    const [
      sector,
      palabras
    ]
    of Object.entries(SECTORES)
  ) {
    const encontradas =
      palabras.filter(
        (palabra) =>
          textoNormalizado.includes(
            normalizar(palabra)
          )
      );

    if (
      encontradas.length > 0
    ) {
      coincidencias.push({
        sector,

        palabrasEncontradas: [
          ...new Set(
            encontradas
          )
        ]
      });
    }
  }

  return coincidencias;
}

/* =========================================================
   SUPABASE
========================================================= */

async function supabaseRequest(
  ruta,
  opciones = {}
) {
  const respuesta =
    await fetch(
      `${SUPABASE_URL}/rest/v1/${ruta}`,
      {
        ...opciones,

        signal:
          AbortSignal.timeout(
            45000
          ),

        headers: {
          apikey:
            SUPABASE_KEY,

          Authorization:
            `Bearer ${SUPABASE_KEY}`,

          "Content-Type":
            "application/json",

          ...(opciones.headers ||
            {})
        }
      }
    );

  if (!respuesta.ok) {
    throw new Error(
      `Supabase ${respuesta.status}: ${await respuesta.text()}`
    );
  }

  if (
    respuesta.status === 204
  ) {
    return null;
  }

  const texto =
    await respuesta.text();

  return texto
    ? JSON.parse(texto)
    : null;
}

async function obtenerUrlsGuardadas() {
  const filas =
    (
      await supabaseRequest(
        "anuncios_boja?select=url_pdf"
      )
    ) || [];

  return new Set(
    filas
      .map(
        (fila) =>
          fila.url_pdf
      )
      .filter(Boolean)
  );
}

async function obtenerUsuarios() {
  return (
    (
      await supabaseRequest(
        "perfiles_usuarios?select=id,email,sectores_suscritos"
      )
    ) || []
  );
}

async function guardarAnuncios(
  documentos
) {
  if (
    documentos.length === 0
  ) {
    return;
  }

  const filas =
    documentos.map(
      (documento) => ({
        titulo:
          documento.titulo
            .substring(
              0,
              1000
            ),

        url_pdf:
          documento.urlPdf,

        categoria:
          documento.sectores.length
            ? documento.sectores
                .map(
                  (sector) =>
                    sector.sector
                )
                .join(", ")
            : "Sin coincidencias"
      })
    );

  await supabaseRequest(
    "anuncios_boja",
    {
      method: "POST",

      headers: {
        Prefer:
          "return=minimal"
      },

      body:
        JSON.stringify(filas)
    }
  );
}

async function guardarNotificaciones(
  notificaciones
) {
  if (
    notificaciones.length === 0
  ) {
    return;
  }

  await supabaseRequest(
    "notificaciones_web",
    {
      method: "POST",

      headers: {
        Prefer:
          "return=minimal"
      },

      body:
        JSON.stringify(
          notificaciones
        )
    }
  );
}

/* =========================================================
   USUARIOS Y SECTORES
========================================================= */

function resolverSectoresUsuario(
  intereses = []
) {
  const resultado =
    new Set();

  for (
    const interes
    of intereses
  ) {
    const interesNormalizado =
      normalizar(interes);

    for (
      const sector
      of Object.keys(SECTORES)
    ) {
      const sectorNormalizado =
        normalizar(sector);

      const coincide =
        sectorNormalizado.includes(
          interesNormalizado
        ) ||
        interesNormalizado.includes(
          sectorNormalizado
        ) ||
        sectorNormalizado
          .split(" ")
          .some(
            (palabra) =>
              palabra.length > 4 &&
              interesNormalizado.includes(
                palabra
              )
          );

      if (coincide) {
        resultado.add(
          sector
        );
      }
    }
  }

  return resultado;
}

/* =========================================================
   CORREO
========================================================= */

function crearHtmlCorreo(
  documentos
) {
  const bloques =
    documentos
      .map((documento) => {
        const palabras = [
          ...new Set(
            documento.coincidencias
              .flatMap(
                (coincidencia) =>
                  coincidencia
                    .palabrasEncontradas
              )
          )
        ];

        const sectores =
          documento.coincidencias
            .map(
              (coincidencia) =>
                coincidencia.sector
            )
            .join(", ");

        return `
          <div style="
            margin:18px 0;
            padding:18px;
            background:#f8fafc;
            border-left:4px solid #008f6a;
            border-radius:7px;
          ">
            <div style="
              color:#006b4f;
              font-size:13px;
              font-weight:bold;
              margin-bottom:8px;
            ">
              ${escaparHtml(sectores)}
            </div>

            <h2 style="
              font-size:17px;
              line-height:1.4;
              color:#172033;
              margin:0 0 10px;
            ">
              ${escaparHtml(
                documento.titulo
              )}
            </h2>

            <p style="
              font-size:13px;
              color:#64748b;
              line-height:1.5;
            ">
              <strong>
                Coincidencias:
              </strong>

              ${escaparHtml(
                palabras
                  .slice(0, 12)
                  .join(", ")
              )}
            </p>

            <a
              href="${escaparHtml(
                documento.urlPdf
              )}"
              target="_blank"
              rel="noopener noreferrer"
              style="
                display:inline-block;
                background:#008f6a;
                color:white;
                text-decoration:none;
                padding:11px 16px;
                border-radius:6px;
                font-size:13px;
                font-weight:bold;
              "
            >
              📄 Abrir PDF oficial exacto
            </a>
          </div>
        `;
      })
      .join("");

  return `
    <div style="
      font-family:Arial,sans-serif;
      background:#f1f5f9;
      padding:24px;
    ">
      <div style="
        max-width:680px;
        margin:auto;
        background:white;
        padding:26px;
        border-radius:10px;
      ">
        <h1 style="
          color:#006b4f;
          margin:0;
        ">
          BoletínHoy
        </h1>

        <p style="
          color:#64748b;
          margin-top:6px;
        ">
          Alertas personalizadas del BOJA
        </p>

        <p style="
          color:#334155;
          line-height:1.6;
        ">
          Hemos encontrado
          <strong>
            ${documentos.length}
          </strong>
          ${
            documentos.length === 1
              ? "publicación nueva"
              : "publicaciones nuevas"
          }
          relacionada${
            documentos.length === 1
              ? ""
              : "s"
          }
          con tus sectores.
        </p>

        ${bloques}

        <p style="
          text-align:center;
          margin-top:24px;
        ">
          <a
            href="https://boletinhoy.es"
            style="
              color:#006b4f;
              font-weight:bold;
              text-decoration:none;
            "
          >
            Entrar en boletinhoy.es
          </a>
        </p>
      </div>
    </div>
  `;
}

async function enviarCorreo(
  email,
  documentos
) {
  const respuesta =
    await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",

        signal:
          AbortSignal.timeout(
            45000
          ),

        headers: {
          Authorization:
            `Bearer ${RESEND_API_KEY}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          from:
            "BoletínHoy <alertas@boletinhoy.es>",

          to: [email],

          subject:
            `🔔 ${documentos.length} ${
              documentos.length === 1
                ? "nueva publicación"
                : "nuevas publicaciones"
            } del BOJA`,

          html:
            crearHtmlCorreo(
              documentos
            )
        })
      }
    );

  if (!respuesta.ok) {
    throw new Error(
      `Resend ${respuesta.status}: ${await respuesta.text()}`
    );
  }

  return respuesta.json();
}

/* =========================================================
   PROCESO PRINCIPAL
========================================================= */

async function ejecutar() {
  console.log(
    "=================================================="
  );

  console.log(
    "🚀 INICIANDO CAPTURADOR BOJA"
  );

  console.log(
    "=================================================="
  );

  /*
   * No busca obligatoriamente el BOJA de hoy.
   * Descubre las publicaciones recientes visibles
   * en portada y RSS.
   */

  const publicaciones =
    await descubrirPublicaciones();

  console.log(
    `📚 Publicaciones recientes: ${publicaciones.length}`
  );

  for (
    const publicacion
    of publicaciones
  ) {
    console.log(
      `   • ${publicacion.url}`
    );
  }

  if (
    publicaciones.length === 0
  ) {
    console.log(
      "ℹ️ No se encontraron publicaciones."
    );

    return;
  }

  const documentosTotales =
    new Map();

  for (
    const publicacion
    of publicaciones
  ) {
    console.log(
      `🔍 Revisando ${publicacion.url}`
    );

    try {
      const documentos =
        await obtenerDocumentosPublicacion(
          publicacion
        );

      console.log(
        `   PDF localizados: ${documentos.length}`
      );

      for (
        const documento
        of documentos
      ) {
        documentosTotales.set(
          documento.urlPdf,
          documento
        );
      }
    } catch (error) {
      console.log(
        `⚠️ No se pudo revisar ${publicacion.url}: ${error.message}`
      );
    }
  }

  const urlsGuardadas =
    await obtenerUrlsGuardadas();

  const documentosNuevos = [
    ...documentosTotales.values()
  ].filter(
    (documento) =>
      !urlsGuardadas.has(
        documento.urlPdf
      )
  );

  console.log(
    `🆕 PDF nuevos: ${documentosNuevos.length}`
  );

  if (
    documentosNuevos.length === 0
  ) {
    console.log(
      "✅ No hay documentos nuevos."
    );

    return;
  }

  const analizados = [];

  for (
    let indice = 0;
    indice <
    documentosNuevos.length;
    indice++
  ) {
    const documento =
      documentosNuevos[indice];

    console.log(
      `📄 Analizando ${indice + 1}/${documentosNuevos.length}`
    );

    try {
      const texto =
        await extraerTextoPdf(
          documento.urlPdf
        );

      const sectores =
        detectarSectores(texto);

      analizados.push({
        ...documento,

        texto,

        titulo:
          documento.tituloPagina ||
          "Documento publicado en el BOJA",

        sectores
      });
    } catch (error) {
      console.log(
        `⚠️ PDF omitido ${documento.urlPdf}: ${error.message}`
      );
    }
  }

  if (
    analizados.length === 0
  ) {
    console.log(
      "ℹ️ No se pudo analizar ningún PDF."
    );

    return;
  }

  await guardarAnuncios(
    analizados
  );

  console.log(
    `✅ Anuncios guardados: ${analizados.length}`
  );

  const conCoincidencias =
    analizados.filter(
      (documento) =>
        documento.sectores.length >
        0
    );

  console.log(
    `🎯 Documentos con coincidencias: ${conCoincidencias.length}`
  );

  if (
    conCoincidencias.length === 0
  ) {
    console.log(
      "ℹ️ No hay coincidencias para notificar."
    );

    return;
  }

  const usuarios =
    await obtenerUsuarios();

  console.log(
    `👥 Usuarios cargados: ${usuarios.length}`
  );

  const notificaciones = [];

  for (
    const usuario
    of usuarios
  ) {
    if (
      !usuario.email ||
      !Array.isArray(
        usuario.sectores_suscritos
      ) ||
      usuario
        .sectores_suscritos
        .length === 0
    ) {
      continue;
    }

    const sectoresPermitidos =
      resolverSectoresUsuario(
        usuario
          .sectores_suscritos
      );

    const documentosUsuario =
      conCoincidencias
        .map((documento) => ({
          ...documento,

          coincidencias:
            documento.sectores
              .filter(
                (coincidencia) =>
                  sectoresPermitidos.has(
                    coincidencia.sector
                  )
              )
        }))
        .filter(
          (documento) =>
            documento
              .coincidencias
              .length > 0
        );

    if (
      documentosUsuario.length ===
      0
    ) {
      console.log(
        `   Sin alertas para ${usuario.email}`
      );

      continue;
    }

    try {
      await enviarCorreo(
        usuario.email,
        documentosUsuario
      );

      console.log(
        `✅ Email enviado a ${usuario.email}`
      );

      for (
        const documento
        of documentosUsuario
      ) {
        notificaciones.push({
          usuario_id:
            usuario.id,

          mensaje:
            `Novedad BOJA: ${documento.titulo.substring(
              0,
              180
            )}`,

          leida: false
        });
      }
    } catch (error) {
      console.log(
        `❌ Error enviando a ${usuario.email}: ${error.message}`
      );
    }
  }

  await guardarNotificaciones(
    notificaciones
  );

  console.log(
    `✅ Notificaciones creadas: ${notificaciones.length}`
  );

  console.log(
    "=================================================="
  );

  console.log(
    "✅ PROCESO COMPLETADO"
  );

  console.log(
    "=================================================="
  );
}

ejecutar().catch(
  (error) => {
    console.error(
      "❌ ERROR GENERAL:",
      error
    );

    process.exitCode = 1;
  }
);
