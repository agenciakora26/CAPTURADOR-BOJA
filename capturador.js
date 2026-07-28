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

const DIAS_A_REVISAR = 21;

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
