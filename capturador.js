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
   DESCUBRIMIENTO DE PUBLICACIONES POR FECHA

   No depende de la portada ni del RSS.
   Consulta el índice oficial de cada fecha reciente:

   /eboja/20260727.html

   Esa página contiene:
   - boletín ordinario;
   - complementarios;
   - extraordinarios publicados ese día.

   Se revisan 21 días para recuperar ejecuciones perdidas.
========================================================= */

const DIAS_A_REVISAR = 2;

function fechaMadridDesdeDesplazamiento(diasAtras = 0) {
  const ahora = new Date();

  /*
   * Trabajamos inicialmente con mediodía UTC para evitar
   * cambios accidentales de fecha por horario de verano.
   */
  const base = new Date(
    Date.UTC(
      ahora.getUTCFullYear(),
      ahora.getUTCMonth(),
      ahora.getUTCDate(),
      12,
      0,
      0
    )
  );

  base.setUTCDate(
    base.getUTCDate() - diasAtras
  );

  const partes =
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(base);

  const datos = {};

  for (const parte of partes) {
    if (parte.type !== "literal") {
      datos[parte.type] = parte.value;
    }
  }

  return {
    anio: datos.year,
    mes: datos.month,
    dia: datos.day,
    compacta:
      `${datos.year}${datos.month}${datos.day}`,
    visible:
      `${datos.day}/${datos.month}/${datos.year}`
  };
}

function interpretarUrlPublicacion(
  enlace,
  base
) {
  let url;

  try {
    url = new URL(enlace, base);
  } catch {
    return null;
  }

  const hostname =
    url.hostname.toLowerCase();

  if (
    hostname !==
      "www.juntadeandalucia.es" &&
    hostname !==
      "juntadeandalucia.es"
  ) {
    return null;
  }

  const partes = url.pathname
    .split("/")
    .filter(Boolean);

  const posicionEboja =
    partes.findIndex(
      (parte) =>
        parte.toLowerCase() ===
          "eboja" ||
        parte.toLowerCase() ===
          "boja"
    );

  if (posicionEboja < 0) {
    return null;
  }

  const anio =
    partes[posicionEboja + 1];

  const numero =
    partes[posicionEboja + 2];

  const posibleComplemento =
    partes[posicionEboja + 3] || "";

  if (
    !/^\d{4}$/.test(anio || "")
  ) {
    return null;
  }

  /*
   * Los boletines ordinarios tienen números como 143.
   * No aceptamos aquí identificadores de disposiciones.
   */
  if (
    !/^\d{1,4}$/.test(numero || "")
  ) {
    return null;
  }

  /*
   * Solo consideramos complementos con el formato oficial:
   * c01, c02, c03...
   */
  const complemento =
    /^c\d{2,3}$/i.test(
      posibleComplemento
    )
      ? posibleComplemento.toLowerCase()
      : "";

  /*
   * Rechazamos páginas de secciones o disposiciones:
   *
   * s52.html
   * 44-verificacion
   * 61
   */
  if (
    posibleComplemento &&
    !complemento &&
    !/^index\.html$/i.test(
      posibleComplemento
    )
  ) {
    return null;
  }

  const urlCanonica = complemento
    ? `${BASE_BOJA}/${anio}/${Number(
        numero
      )}/${complemento}/`
    : `${BASE_BOJA}/${anio}/${Number(
        numero
      )}/`;

  return {
    anio,
    numero: Number(numero),
    complemento,
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

  if (a.numero !== b.numero) {
    return b.numero - a.numero;
  }

  if (
    !a.complemento &&
    b.complemento
  ) {
    return -1;
  }

  if (
    a.complemento &&
    !b.complemento
  ) {
    return 1;
  }

  return String(a.complemento)
    .localeCompare(
      String(b.complemento),
      "es",
      {
        numeric: true
      }
    );
}

async function obtenerPublicacionesDeFecha(
  fecha
) {
  const urlFecha =
    `${BASE_BOJA}/${fecha.compacta}.html`;

  console.log(
    `🔎 Revisando publicaciones del ${fecha.visible}...`
  );

  let respuesta;

  try {
    respuesta = await descargar(
      urlFecha,
      "text/html"
    );
  } catch (error) {
    /*
     * Algunos días sin publicación pueden devolver 404.
     * No constituye un error del capturador.
     */
    if (
      String(error.message).includes(
        "HTTP 404"
      )
    ) {
      console.log(
        "   Sin página de publicaciones para esta fecha."
      );

      return [];
    }

    throw error;
  }

  const html =
    await respuesta.text();

  const $ =
    cheerio.load(html);

  const mapa =
    new Map();

  /*
   * Fuente principal: enlaces reales de la página oficial.
   */

  $("a[href]").each(
    (_, elemento) => {
      const href =
        $(elemento).attr("href");

      const publicacion =
        interpretarUrlPublicacion(
          href,
          respuesta.url
        );

      if (!publicacion) {
        return;
      }

      if (
        publicacion.anio !==
        fecha.anio
      ) {
        return;
      }

      mapa.set(
        publicacion.url,
        publicacion
      );
    }
  );

  /*
   * Respaldo por si los enlaces aparecen dentro de atributos
   * o fragmentos HTML no seleccionados por Cheerio.
   *
   * No se inventa ningún número: solo se utilizan rutas que
   * están presentes literalmente en la página oficial.
   */

  const rutas =
    html.match(
      /\/(?:eboja|boja)\/\d{4}\/\d{1,4}(?:\/c\d{2,3})?(?:\/index\.html)?\/?/gi
    ) || [];

  for (const ruta of rutas) {
    const publicacion =
      interpretarUrlPublicacion(
        ruta,
        respuesta.url
      );

    if (!publicacion) {
      continue;
    }

    if (
      publicacion.anio !==
      fecha.anio
    ) {
      continue;
    }

    mapa.set(
      publicacion.url,
      publicacion
    );
  }

  const publicaciones = [
    ...mapa.values()
  ].sort(ordenarPublicaciones);

  console.log(
    `   Publicaciones encontradas: ${publicaciones.length}`
  );

  for (
    const publicacion
    of publicaciones
  ) {
    console.log(
      `   • ${publicacion.url}`
    );
  }

  return publicaciones;
}

async function validarPublicacion(
  publicacion
) {
  const urlsPrueba = [
    publicacion.url,
    `${publicacion.url}index.html`
  ];

  for (const url of urlsPrueba) {
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

      const tieneCabeceraBoja =
        texto.includes(
          "boletin oficial de la junta de andalucia"
        ) ||
        texto.includes(
          "sede electronica del boja"
        ) ||
        texto.includes(
          `boletin numero ${publicacion.numero}`
        ) ||
        texto.includes(
          `boletin ${publicacion.numero} complementario`
        );

      const tieneContenido =
        $("a[href]").filter(
          (_, elemento) => {
            const href =
              $(elemento).attr(
                "href"
              ) || "";

            const textoEnlace =
              normalizar(
                $(elemento).text()
              );

            return (
              /\.pdf(?:$|[?#])/i.test(
                href
              ) ||
              textoEnlace.includes(
                "pdf oficial autentico"
              )
            );
          }
        ).length > 0 ||
        $("a[href*='/s']").length >
          0;

      if (
        !tieneCabeceraBoja ||
        !tieneContenido
      ) {
        continue;
      }

      return {
        ...publicacion,
        html,
        url: publicacion.url
      };
    } catch (error) {
      if (
        !String(
          error.message
        ).includes("HTTP 404")
      ) {
        console.log(
          `   Error validando ${url}: ${error.message}`
        );
      }
    }
  }

  return null;
}

async function descubrirPublicaciones() {
  console.log(
    `📅 Revisando los últimos ${DIAS_A_REVISAR} días...`
  );

  const candidatos =
    new Map();

  /*
   * Recorremos días naturales recientes.
   * Por tanto:
   *
   * - funciona aunque hoy no haya BOJA;
   * - recupera publicaciones perdidas;
   * - incluye complementarios;
   * - no obliga a conocer previamente el número.
   */

  for (
    let diasAtras = 0;
    diasAtras < DIAS_A_REVISAR;
    diasAtras++
  ) {
    const fecha =
      fechaMadridDesdeDesplazamiento(
        diasAtras
      );

    try {
      const publicaciones =
        await obtenerPublicacionesDeFecha(
          fecha
        );

      for (
        const publicacion
        of publicaciones
      ) {
        candidatos.set(
          publicacion.url,
          publicacion
        );
      }
    } catch (error) {
      console.log(
        `⚠️ No se pudo revisar ${fecha.visible}: ${error.message}`
      );
    }
  }

  const candidatosOrdenados = [
    ...candidatos.values()
  ].sort(ordenarPublicaciones);

  console.log(
    `📚 Candidatos únicos encontrados: ${candidatosOrdenados.length}`
  );

  const resultado = [];

  for (
    const candidato
    of candidatosOrdenados
  ) {
    const validada =
      await validarPublicacion(
        candidato
      );

    if (validada) {
      resultado.push(validada);
    } else {
      console.log(
        `   Publicación descartada: ${candidato.url}`
      );
    }
  }

  console.log(
    `📚 Publicaciones válidas: ${resultado.length}`
  );

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
