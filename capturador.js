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
   INTERPRETAR URL DEL BOJA
========================================================= */

/*
 * Esta función separa correctamente:
 *
 * /eboja/2026/143/
 * /eboja/2026/143/index.html
 * /eboja/2026/143/c01/
 * /eboja/2026/143/c02/index.html
 * /eboja/2026/143/s52.html
 * /eboja/2026/143/c01/s52.html
 *
 * Nunca convierte 143/c02 en 14302.
 */

function extraerPublicacion(url = "") {
  let pathname;

  try {
    pathname =
      new URL(url, BASE_BOJA).pathname;
  } catch {
    return null;
  }

  const partes = pathname
    .split("/")
    .filter(Boolean);

  const posicionBoja =
    partes.findIndex((parte) => {
      const valor =
        parte.toLowerCase();

      return (
        valor === "eboja" ||
        valor === "boja"
      );
    });

  if (posicionBoja < 0) {
    return null;
  }

  const anio =
    partes[posicionBoja + 1];

  const numeroTexto =
    partes[posicionBoja + 2];

  const siguienteParte =
    partes[posicionBoja + 3] || "";

  if (
    !/^\d{4}$/.test(anio || "")
  ) {
    return null;
  }

  /*
   * Limitamos el número a un máximo de 4 cifras.
   * Evita interpretar cadenas como 214302.
   */

  if (
    !/^\d{1,4}$/.test(
      numeroTexto || ""
    )
  ) {
    return null;
  }

  const numero =
    Number(numeroTexto);

  if (
    !Number.isInteger(numero) ||
    numero < 1 ||
    numero > 9999
  ) {
    return null;
  }

  /*
   * Admite complementos o ediciones como:
   * c01, c02, e01...
   *
   * No confunde s52.html con un complemento.
   */

  const edicion =
    /^[a-z]\d{1,3}$/i.test(
      siguienteParte
    )
      ? siguienteParte.toLowerCase()
      : "";

  const urlCanonica = edicion
    ? `${BASE_BOJA}/${anio}/${numero}/${edicion}/`
    : `${BASE_BOJA}/${anio}/${numero}/`;

  return {
    anio,
    numero,
    edicion,
    url: urlCanonica
  };
}

function ordenarPublicaciones(a, b) {
  if (
    Number(a.anio) !==
    Number(b.anio)
  ) {
    return (
      Number(b.anio) -
      Number(a.anio)
    );
  }

  if (
    a.numero !== b.numero
  ) {
    return b.numero - a.numero;
  }

  if (
    !a.edicion &&
    b.edicion
  ) {
    return -1;
  }

  if (
    a.edicion &&
    !b.edicion
  ) {
    return 1;
  }

  return String(b.edicion)
    .localeCompare(
      String(a.edicion),
      "es",
      {
        numeric: true
      }
    );
}

function registrarCandidato(
  mapa,
  enlace,
  base = PORTADA_BOJA
) {
  const absoluta =
    urlAbsoluta(enlace, base);

  if (!absoluta) {
    return;
  }

  const publicacion =
    extraerPublicacion(absoluta);

  if (!publicacion) {
    return;
  }

  mapa.set(
    publicacion.url,
    publicacion
  );
}

/* =========================================================
   DESCUBRIR PUBLICACIONES
========================================================= */

async function candidatosDesdePortada() {
  console.log(
    "🔎 Consultando la portada oficial del BOJA..."
  );

  const respuesta =
    await descargar(
      PORTADA_BOJA,
      "text/html"
    );

  const html =
    await respuesta.text();

  const $ =
    cheerio.load(html);

  const mapa =
    new Map();

  /*
   * Revisamos los enlaces reales.
   */

  $("a[href]").each(
    (_, elemento) => {
      registrarCandidato(
        mapa,
        $(elemento).attr("href"),
        respuesta.url
      );
    }
  );

  /*
   * Revisamos también las rutas escritas
   * dentro del HTML o scripts.
   */

  const expresion =
    /\/(?:eboja|boja)\/\d{4}\/\d{1,4}(?:\/[a-z]\d{1,3})?(?:\/index\.html)?\/?/gi;

  let coincidencia;

  while (
    (coincidencia =
      expresion.exec(html)) !== null
  ) {
    registrarCandidato(
      mapa,
      coincidencia[0],
      PORTADA_BOJA
    );
  }

  return [
    ...mapa.values()
  ].sort(ordenarPublicaciones);
}

async function candidatosDesdeRss() {
  console.log(
    "🔎 Consultando el RSS oficial como respaldo..."
  );

  const respuesta =
    await descargar(
      RSS_BOJA,
      "application/xml,text/xml"
    );

  const xml =
    await respuesta.text();

  const $ =
    cheerio.load(xml, {
      xmlMode: true
    });

  const mapa =
    new Map();

  $("entry,item").each(
    (_, elemento) => {
      const entrada =
        $(elemento);

      const valores = [
        entrada
          .find("link[href]")
          .first()
          .attr("href"),

        entrada
          .find("link")
          .first()
          .text()
          .trim(),

        entrada
          .find("guid")
          .first()
          .text()
          .trim(),

        entrada.text()
      ].filter(Boolean);

      for (
        const valor of valores
      ) {
        const urls =
          String(valor).match(
            /https?:\/\/[^\s<>"']+\/(?:eboja|boja)\/\d{4}\/\d{1,4}(?:\/[a-z]\d{1,3})?/gi
          ) || [];

        for (
          const enlace of urls
        ) {
          registrarCandidato(
            mapa,
            enlace
          );
        }

        /*
         * También permite rutas relativas.
         */

        const rutas =
          String(valor).match(
            /\/(?:eboja|boja)\/\d{4}\/\d{1,4}(?:\/[a-z]\d{1,3})?/gi
          ) || [];

        for (
          const ruta of rutas
        ) {
          registrarCandidato(
            mapa,
            ruta,
            RSS_BOJA
          );
        }
      }
    }
  );

  return [
    ...mapa.values()
  ].sort(ordenarPublicaciones);
}

async function validarPublicacion(
  publicacion
) {
  const urlsPrueba = [
    publicacion.url,
    `${publicacion.url}index.html`
  ];

  for (
    const url of urlsPrueba
  ) {
    try {
      const respuesta =
        await descargar(
          url,
          "text/html"
        );

      const html =
        await respuesta.text();

      const $ =
        cheerio.load(html);

      const texto =
        normalizar(
          $("body").text()
        );

      const esPaginaBoja =
        texto.length > 100 &&
        (
          texto.includes(
            "boletin oficial"
          ) ||
          texto.includes("boja")
        );

      if (!esPaginaBoja) {
        continue;
      }

      return {
        ...publicacion,
        url:
          publicacion.url,
        html
      };
    } catch (error) {
      console.log(
        `   No válida ${url}: ${error.message}`
      );
    }
  }

  return null;
}

async function descubrirEdiciones(
  publicacion
) {
  const mapa =
    new Map();

  mapa.set(
    publicacion.url,
    publicacion
  );

  const $ =
    cheerio.load(
      publicacion.html || ""
    );

  $("a[href]").each(
    (_, elemento) => {
      const absoluta =
        urlAbsoluta(
          $(elemento).attr("href"),
          publicacion.url
        );

      const descubierta =
        extraerPublicacion(absoluta);

      if (!descubierta) {
        return;
      }

      if (
        descubierta.anio !==
          publicacion.anio ||
        descubierta.numero !==
          publicacion.numero
      ) {
        return;
      }

      mapa.set(
        descubierta.url,
        descubierta
      );
    }
  );

  /*
   * También busca complementos dentro del HTML.
   */

  const regex =
    new RegExp(
      `/(?:eboja|boja)/${publicacion.anio}/${publicacion.numero}/([a-z]\\d{1,3})(?:/|")`,
      "gi"
    );

  let coincidencia;

  while (
    (coincidencia =
      regex.exec(
        publicacion.html || ""
      )) !== null
  ) {
    registrarCandidato(
      mapa,
      `${BASE_BOJA}/${publicacion.anio}/${publicacion.numero}/${coincidencia[1]}/`
    );
  }

  return [
    ...mapa.values()
  ];
}

async function descubrirPublicaciones() {
  const mapaInicial =
    new Map();

  try {
    const portada =
      await candidatosDesdePortada();

    for (
      const publicacion
      of portada
    ) {
      mapaInicial.set(
        publicacion.url,
        publicacion
      );
    }
  } catch (error) {
    console.log(
      `⚠️ Error en portada: ${error.message}`
    );
  }

  try {
    const rss =
      await candidatosDesdeRss();

    for (
      const publicacion
      of rss
    ) {
      mapaInicial.set(
        publicacion.url,
        publicacion
      );
    }
  } catch (error) {
    console.log(
      `⚠️ Error en RSS: ${error.message}`
    );
  }

  /*
   * Revisamos las publicaciones más recientes.
   * No obliga a que sean del día actual.
   */

  const candidatos = [
    ...mapaInicial.values()
  ]
    .sort(ordenarPublicaciones)
    .slice(0, 40);

  console.log(
    `📚 Candidatos encontrados: ${candidatos.length}`
  );

  const validadas =
    new Map();

  for (
    const candidato
    of candidatos
  ) {
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

    /*
     * Si es el boletín principal,
     * buscamos complementos o ediciones.
     */

    if (!validada.edicion) {
      const ediciones =
        await descubrirEdiciones(
          validada
        );

      for (
        const edicion
        of ediciones
      ) {
        validadas.set(
          edicion.url,
          edicion
        );
      }
    }
  }

  const resultado = [];

  for (
    const publicacion
    of [
      ...validadas.values()
    ].sort(ordenarPublicaciones)
  ) {
    if (publicacion.html) {
      resultado.push(
        publicacion
      );

      continue;
    }

    const validada =
      await validarPublicacion(
        publicacion
      );

    if (validada) {
      resultado.push(
        validada
      );
    }
  }

  return resultado;
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
