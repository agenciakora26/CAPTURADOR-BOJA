const cheerio = require("cheerio");
const pdfParse = require("pdf-parse");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "")
  .replace(/\/rest\/v1\/?$/i, "")
  .replace(/\/+$/, "");

const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

const PORTADA = "https://www.juntadeandalucia.es/eboja.html";
const RSS = "https://www.juntadeandalucia.es/boja/distribucion/s51.xml";
const BASE = "https://www.juntadeandalucia.es/eboja";

const USER_AGENT =
  "Mozilla/5.0 (compatible; BoletinHoy/1.0; +https://boletinhoy.es)";

if (!SUPABASE_URL || !SUPABASE_KEY || !RESEND_API_KEY) {
  console.error(
    "Faltan SUPABASE_URL, SUPABASE_KEY o RESEND_API_KEY."
  );

  process.exit(1);
}

const SECTORES = {
  "oposiciones y empleo público": [
    "oposición",
    "oposiciones",
    "concurso-oposición",
    "proceso selectivo",
    "pruebas selectivas",
    "empleo público",
    "oferta de empleo público",
    "bolsa de empleo",
    "bolsa de trabajo",
    "turno libre",
    "plazas vacantes",
    "personal funcionario",
    "personal laboral",
    "personal estatutario",
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
    "incentivo",
    "incentivos",
    "beneficiarios",
    "concurrencia competitiva",
    "plazo de solicitud",
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
    "desarrollo rural",
    "sector agrario",
    "sector pesquero",
    "acuicultura"
  ],

  "hostelería y comercio": [
    "hostelería",
    "hostelero",
    "hostelera",
    "comercio",
    "turismo",
    "turístico",
    "restauración",
    "establecimientos turísticos",
    "alojamientos turísticos",
    "hoteles",
    "agencias de viajes",
    "artesanía"
  ],

  "licitaciones y contratación": [
    "licitación",
    "licitaciones",
    "contratación pública",
    "contrato público",
    "contrato menor",
    "mesa de contratación",
    "adjudicación",
    "adjudicaciones",
    "formalización de contrato",
    "procedimiento abierto",
    "acuerdo marco"
  ],

  "sanidad y servicios sociales": [
    "servicio andaluz de salud",
    "sanidad",
    "salud",
    "hospital",
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

function normalizar(valor = "") {
  return String(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”«»"'’]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function urlAbsoluta(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function escaparHtml(valor = "") {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
    throw new Error(
      `HTTP ${respuesta.status} al consultar ${url}`
    );
  }

  return respuesta;
}

function extraerPublicacion(url = "") {
  const coincidencia = String(url).match(
  /\/(?:eboja|boja)\/(\d{4})\/(\d+)(?:\/(c\d+))?(?:\/index\.html)?\/?(?:[?#].*)?$/i
);

  if (!coincidencia) {
    return null;
  }

  const anio = coincidencia[1];
  const numero = Number(coincidencia[2]);
  const complemento = (
    coincidencia[3] || ""
  ).toLowerCase();

  return {
    anio,
    numero,
    complemento,
    url:
      `${BASE}/${anio}/${numero}/` +
      `${complemento ? `${complemento}/` : ""}`
  };
}

function ordenarPublicaciones(a, b) {
  if (Number(a.anio) !== Number(b.anio)) {
    return Number(b.anio) - Number(a.anio);
  }

  if (a.numero !== b.numero) {
    return b.numero - a.numero;
  }

  if (!a.complemento && b.complemento) {
    return -1;
  }

  if (a.complemento && !b.complemento) {
    return 1;
  }

  return b.complemento.localeCompare(
    a.complemento,
    "es",
    {
      numeric: true
    }
  );
}

function registrarCandidato(
  mapa,
  enlace,
  base = PORTADA
) {
  const absoluta = urlAbsoluta(enlace, base);

  if (!absoluta) {
    return;
  }

  const publicacion = extraerPublicacion(absoluta);

  if (!publicacion) {
    return;
  }

  mapa.set(publicacion.url, publicacion);
}

async function obtenerCandidatosPortada() {
  console.log(
    "Consultando la portada oficial del BOJA..."
  );

  const respuesta = await descargar(
    PORTADA,
    "text/html"
  );

  const html = await respuesta.text();
  const $ = cheerio.load(html);
  const mapa = new Map();

  $("a[href]").each((_, elemento) => {
    registrarCandidato(
      mapa,
      $(elemento).attr("href"),
      respuesta.url
    );
  });

  const expresion =
    /\/(?:e?boja|boja)\/(\d{4})\/(\d+)(?:\/(c\d+))?(?:\/index\.html|\/)?/gi;

  let coincidencia;

  while (
    (coincidencia = expresion.exec(html))
  ) {
    registrarCandidato(
      mapa,
      `${BASE}/${coincidencia[1]}/` +
        `${coincidencia[2]}/` +
        `${
          coincidencia[3]
            ? `${coincidencia[3]}/`
            : ""
        }`
    );
  }

  return [...mapa.values()].sort(
    ordenarPublicaciones
  );
}

async function obtenerCandidatosRss() {
  console.log(
    "Consultando el RSS oficial como respaldo..."
  );

  const respuesta = await descargar(
    RSS,
    "application/xml,text/xml"
  );

  const xml = await respuesta.text();

  const $ = cheerio.load(xml, {
    xmlMode: true
  });

  const mapa = new Map();

  $("entry,item").each((_, elemento) => {
    const entrada = $(elemento);

    const enlaces = [
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
        .text()
    ].filter(Boolean);

    for (const enlace of enlaces) {
      const coincidencia = String(enlace).match(
        /\/(?:e?boja|boja)\/(\d{4})\/(\d+)/i
      );

      if (!coincidencia) {
        continue;
      }

      registrarCandidato(
        mapa,
        `${BASE}/${coincidencia[1]}/` +
          `${coincidencia[2]}/`
      );
    }
  });

  return [...mapa.values()].sort(
    ordenarPublicaciones
  );
}

async function validarPublicacion(publicacion) {
  const urls = [
    publicacion.url,
    `${publicacion.url}index.html`
  ];

  for (const url of urls) {
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

      const pareceBoja =
        texto.length > 100 &&
        (
          texto.includes(
            "boletin oficial"
          ) ||
          texto.includes("boja")
        );

      if (pareceBoja) {
        return {
          ...publicacion,
          html
        };
      }
    } catch (error) {
      console.log(
        `No válido ${url}: ${error.message}`
      );
    }
  }

  return null;
}

async function descubrirPublicaciones() {
  const mapa = new Map();

  try {
    const portada =
      await obtenerCandidatosPortada();

    for (const publicacion of portada) {
      mapa.set(
        publicacion.url,
        publicacion
      );
    }
  } catch (error) {
    console.log(
      `Error consultando portada: ${error.message}`
    );
  }

  try {
    const rss =
      await obtenerCandidatosRss();

    for (const publicacion of rss) {
      mapa.set(
        publicacion.url,
        publicacion
      );
    }
  } catch (error) {
    console.log(
      `Error consultando RSS: ${error.message}`
    );
  }

  const candidatos = [
    ...mapa.values()
  ]
    .sort(ordenarPublicaciones)
    .slice(0, 20);

  const resultado = new Map();

  for (const publicacion of candidatos) {
    const validada =
      await validarPublicacion(publicacion);

    if (!validada) {
      continue;
    }

    resultado.set(
      validada.url,
      validada
    );

    if (!validada.complemento) {
      const $ = cheerio.load(
        validada.html
      );

      $("a[href]").each((_, elemento) => {
        const absoluta = urlAbsoluta(
          $(elemento).attr("href"),
          validada.url
        );

        const complemento =
          extraerPublicacion(absoluta);

        if (
          complemento &&
          complemento.anio ===
            validada.anio &&
          complemento.numero ===
            validada.numero &&
          complemento.complemento
        ) {
          resultado.set(
            complemento.url,
            complemento
          );
        }
      });
    }
  }

  const publicacionesFinales = [];

  for (
    const publicacion of [
      ...resultado.values()
    ].sort(ordenarPublicaciones)
  ) {
    const validada =
      publicacion.html
        ? publicacion
        : await validarPublicacion(
            publicacion
          );

    if (validada) {
      publicacionesFinales.push(
        validada
      );
    }
  }

  return publicacionesFinales;
}

async function obtenerDocumentosPublicacion(
  publicacion
) {
  const paginas = new Set([
    publicacion.url
  ]);

  const respuesta = await descargar(
    publicacion.url,
    "text/html"
  );

  const html = await respuesta.text();
  const $ = cheerio.load(html);

  $("a[href]").each((_, elemento) => {
    const url = urlAbsoluta(
      $(elemento).attr("href"),
      respuesta.url
    );

    if (!url) {
      return;
    }

    if (!url.startsWith(publicacion.url)) {
      return;
    }

    if (
      /\/s\d+(?:\.html)?(?:[?#].*)?$/i.test(
        url
      )
    ) {
      paginas.add(
        url.split(/[?#]/)[0]
      );
    }
  });

  const documentos = new Map();

  for (const pagina of paginas) {
    try {
      const respuestaPagina =
        await descargar(
          pagina,
          "text/html"
        );

      const htmlPagina =
        await respuestaPagina.text();

      const $pagina =
        cheerio.load(htmlPagina);

      $pagina("a[href]").each(
        (_, elemento) => {
          const enlace =
            $pagina(elemento);

          const href =
            enlace.attr("href") || "";

          const textoEnlace =
            normalizar(enlace.text());

          const parecePdf =
            /\.pdf(?:$|[?#])/i.test(href) ||
            textoEnlace.includes(
              "pdf oficial autentico"
            );

          if (!parecePdf) {
            return;
          }

          const urlPdf = urlAbsoluta(
            href,
            respuestaPagina.url
          );

          if (!urlPdf) {
            return;
          }

          const contexto = normalizar(
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

          const titulo =
            enlace
              .closest(
                "li,article,div"
              )
              .text()
              .replace(/\s+/g, " ")
              .trim()
              .substring(0, 1000) ||
            "Documento publicado en el BOJA";

          documentos.set(
            urlPdf,
            {
              urlPdf,
              tituloPagina: titulo
            }
          );
        }
      );
    } catch (error) {
      console.log(
        `Página omitida ${pagina}: ${error.message}`
      );
    }
  }

  return [...documentos.values()];
}

async function extraerTextoPdf(url) {
  const respuesta = await descargar(
    url,
    "application/pdf"
  );

  const buffer = Buffer.from(
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

function detectarSectores(texto) {
  const textoNormalizado =
    normalizar(texto);

  const resultados = [];

  for (
    const [sector, palabras]
    of Object.entries(SECTORES)
  ) {
    const encontradas =
      palabras.filter((palabra) =>
        textoNormalizado.includes(
          normalizar(palabra)
        )
      );

    if (encontradas.length > 0) {
      resultados.push({
        sector,
        palabrasEncontradas: [
          ...new Set(encontradas)
        ]
      });
    }
  }

  return resultados;
}

async function supabaseRequest(
  ruta,
  opciones = {}
) {
  const respuesta = await fetch(
    `${SUPABASE_URL}/rest/v1/${ruta}`,
    {
      ...opciones,

      signal:
        AbortSignal.timeout(45000),

      headers: {
        apikey: SUPABASE_KEY,

        Authorization:
          `Bearer ${SUPABASE_KEY}`,

        "Content-Type":
          "application/json",

        ...(opciones.headers || {})
      }
    }
  );

  if (!respuesta.ok) {
    throw new Error(
      `Supabase ${respuesta.status}: ` +
      `${await respuesta.text()}`
    );
  }

  if (respuesta.status === 204) {
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
    await supabaseRequest(
      "anuncios_boja?select=url_pdf"
    ) || [];

  return new Set(
    filas
      .map((fila) => fila.url_pdf)
      .filter(Boolean)
  );
}

async function obtenerUsuarios() {
  return (
    await supabaseRequest(
      "perfiles_usuarios" +
      "?select=id,email,sectores_suscritos"
    )
  ) || [];
}

function resolverSectoresUsuario(
  intereses = []
) {
  const resultado = new Set();

  for (const interes of intereses) {
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
          documento.coincidencias
            .flatMap(
              (coincidencia) =>
                coincidencia
                  .palabrasEncontradas
            )
        )
      ];

      return `
        <div style="
          margin:18px 0;
          padding:16px;
          background:#f8fafc;
          border-left:4px solid #008f6a;
          border-radius:7px;
        ">
          <h2 style="
            font-size:17px;
            color:#172033;
          ">
            ${escaparHtml(
              documento.titulo
            )}
          </h2>

          <p style="
            font-size:13px;
            color:#64748b;
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
            style="
              display:inline-block;
              background:#008f6a;
              color:white;
              text-decoration:none;
              padding:11px 16px;
              border-radius:6px;
              font-weight:700;
            "
          >
            Abrir PDF oficial exacto
          </a>
        </div>
      `;
    })
    .join("");

  return `
    <div style="
      font-family:Arial;
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
        ">
          BoletínHoy
        </h1>

        <p>
          Hemos encontrado
          ${documentos.length}
          publicación${
            documentos.length === 1
              ? ""
              : "es"
          }
          relacionada${
            documentos.length === 1
              ? ""
              : "s"
          }
          con tus sectores.
        </p>

        ${bloques}
      </div>
    </div>
  `;
}

async function enviarCorreo(
  email,
  documentos
) {
  const respuesta = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",

      signal:
        AbortSignal.timeout(45000),

      headers: {
        Authorization:
          `Bearer ${RESEND_API_KEY}`,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        from:
          "BoletínHoy " +
          "<alertas@boletinhoy.es>",

        to: [email],

        subject:
          `${documentos.length} ` +
          `nueva${
            documentos.length === 1
              ? ""
              : "s"
          } publicación${
            documentos.length === 1
              ? ""
              : "es"
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
      `Resend ${respuesta.status}: ` +
      `${await respuesta.text()}`
    );
  }
}

async function ejecutar() {
  console.log(
    "INICIANDO CAPTURADOR BOJA"
  );

  const publicaciones =
    await descubrirPublicaciones();

  console.log(
    `Publicaciones recientes: ` +
    `${publicaciones.length}`
  );

  if (
    publicaciones.length === 0
  ) {
    console.log(
      "No se encontraron publicaciones."
    );

    return;
  }

  const mapaDocumentos =
    new Map();

  for (
    const publicacion
    of publicaciones
  ) {
    console.log(
      `Revisando ${publicacion.url}`
    );

    try {
      const documentos =
        await obtenerDocumentosPublicacion(
          publicacion
        );

      for (
        const documento
        of documentos
      ) {
        mapaDocumentos.set(
          documento.urlPdf,
          documento
        );
      }
    } catch (error) {
      console.log(
        `No se pudo revisar ` +
        `${publicacion.url}: ` +
        `${error.message}`
      );
    }
  }

  const guardadas =
    await obtenerUrlsGuardadas();

  const nuevos = [
    ...mapaDocumentos.values()
  ].filter(
    (documento) =>
      !guardadas.has(
        documento.urlPdf
      )
  );

  console.log(
    `PDF nuevos: ${nuevos.length}`
  );

  if (nuevos.length === 0) {
    console.log(
      "No hay documentos nuevos."
    );

    return;
  }

  const analizados = [];

  for (
    let indice = 0;
    indice < nuevos.length;
    indice++
  ) {
    const documento =
      nuevos[indice];

    try {
      console.log(
        `Analizando ` +
        `${indice + 1}/` +
        `${nuevos.length}`
      );

      const texto =
        await extraerTextoPdf(
          documento.urlPdf
        );

      analizados.push({
        ...documento,

        texto,

        titulo:
          documento.tituloPagina,

        sectores:
          detectarSectores(texto)
      });
    } catch (error) {
      console.log(
        `PDF omitido: ${error.message}`
      );
    }
  }

  if (
    analizados.length === 0
  ) {
    return;
  }

  await supabaseRequest(
    "anuncios_boja",
    {
      method: "POST",

      headers: {
        Prefer:
          "return=minimal"
      },

      body: JSON.stringify(
        analizados.map(
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
        )
      )
    }
  );

  const conCoincidencias =
    analizados.filter(
      (documento) =>
        documento.sectores.length
    );

  if (
    conCoincidencias.length === 0
  ) {
    console.log(
      "No hay coincidencias."
    );

    return;
  }

  const usuarios =
    await obtenerUsuarios();

  const notificaciones = [];

  for (
    const usuario
    of usuarios
  ) {
    if (
      !usuario.email ||
      !Array.isArray(
        usuario.sectores_suscritos
      )
    ) {
      continue;
    }

    const permitidos =
      resolverSectoresUsuario(
        usuario.sectores_suscritos
      );

    const documentosUsuario =
      conCoincidencias
        .map((documento) => ({
          ...documento,

          coincidencias:
            documento.sectores
              .filter(
                (sector) =>
                  permitidos.has(
                    sector.sector
                  )
              )
        }))
        .filter(
          (documento) =>
            documento
              .coincidencias
              .length
        );

    if (
      documentosUsuario.length === 0
    ) {
      continue;
    }

    try {
      await enviarCorreo(
        usuario.email,
        documentosUsuario
      );

      console.log(
        `Email enviado a ` +
        `${usuario.email}`
      );

      for (
        const documento
        of documentosUsuario
      ) {
        notificaciones.push({
          usuario_id:
            usuario.id,

          mensaje:
            `Novedad BOJA: ` +
            documento.titulo
              .substring(
                0,
                180
              ),

          leida: false
        });
      }
    } catch (error) {
      console.log(
        `Error enviando a ` +
        `${usuario.email}: ` +
        `${error.message}`
      );
    }
  }

  if (
    notificaciones.length > 0
  ) {
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

  console.log(
    "PROCESO COMPLETADO"
  );
}

ejecutar().catch((error) => {
  console.error(
    "ERROR GENERAL:",
    error
  );

  process.exitCode = 1;
});
