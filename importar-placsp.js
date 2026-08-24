/**
 * ============================================================
 * BOLETÍNHOY · IMPORTADOR DE EMPRESAS Y CONTRATOS PLACSP
 * ============================================================
 *
 * Node.js 20+
 *
 * Secretos de GitHub utilizados:
 *
 * SUPABASE_URL
 * SUPABASE_KEY
 *
 * NO introducir claves directamente en este archivo.
 *
 * Tablas Supabase:
 *
 * bh_empresas_publicas
 * bh_contratos_publicos
 *
 * RPC:
 *
 * bh_actualizar_totales_empresa
 *
 * ============================================================
 */

import { createClient } from "@supabase/supabase-js";
import { XMLParser } from "fast-xml-parser";
import crypto from "node:crypto";


// ============================================================
// CONFIGURACIÓN
// ============================================================

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_KEY =
  process.env.SUPABASE_KEY;


const PLACSP_START_FEED =
  process.env.PLACSP_START_FEED ||
  "https://contrataciondelestado.es/feeds/portaldetransparencia/licitaciones.atom";


const PLACSP_MAX_PAGES =
  Math.max(
    Number(
      process.env.PLACSP_MAX_PAGES || 1
    ),
    1
  );


const PLACSP_DELAY_MS =
  Math.max(
    Number(
      process.env.PLACSP_DELAY_MS || 750
    ),
    0
  );


const DRY_RUN =
  String(
    process.env.DRY_RUN || "false"
  ).toLowerCase() === "true";


// ============================================================
// COMPROBAR VARIABLES
// ============================================================

if (
  !SUPABASE_URL ||
  !SUPABASE_KEY
) {

  console.error(
    "❌ Faltan SUPABASE_URL o SUPABASE_KEY."
  );

  process.exit(1);

}


// ============================================================
// SUPABASE
// ============================================================

const supabase =
  createClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );


// ============================================================
// PARSER XML
// ============================================================

const parser =
  new XMLParser({

    ignoreAttributes: false,

    attributeNamePrefix: "@_",

    removeNSPrefix: true,

    trimValues: true,

    parseTagValue: false,

    parseAttributeValue: false

  });


// ============================================================
// UTILIDADES
// ============================================================

const sleep = ms =>
  new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );


function asArray(value) {

  if (
    value === undefined ||
    value === null
  ) {
    return [];
  }

  return Array.isArray(value)
    ? value
    : [value];

}


function scalar(value) {

  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {

    const texto =
      String(value).trim();

    return texto || null;

  }

  if (
    typeof value === "object"
  ) {

    if (
      "#text" in value
    ) {
      return scalar(
        value["#text"]
      );
    }

    if (
      "_" in value
    ) {
      return scalar(
        value["_"]
      );
    }

  }

  return null;

}


function cleanText(value) {

  return String(
    value || ""
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}


function cleanNif(value) {

  return String(
    value || ""
  )
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      ""
    )
    .trim();

}


function numberValue(value) {

  const texto =
    scalar(value);

  if (!texto) {
    return null;
  }

  const numero =
    Number(
      String(texto)
        .replace(",", ".")
    );

  return Number.isFinite(numero)
    ? numero
    : null;

}


function integerValue(value) {

  const numero =
    numberValue(value);

  if (
    numero === null
  ) {
    return null;
  }

  return Math.trunc(numero);

}


function booleanValue(value) {

  const texto =
    scalar(value);

  if (!texto) {
    return null;
  }

  const valor =
    texto
      .toLowerCase()
      .trim();

  if (
    [
      "true",
      "1",
      "si",
      "sí",
      "yes"
    ].includes(valor)
  ) {
    return true;
  }

  if (
    [
      "false",
      "0",
      "no"
    ].includes(valor)
  ) {
    return false;
  }

  return null;

}


function dateOnly(value) {

  const texto =
    scalar(value);

  if (!texto) {
    return null;
  }

  const match =
    String(texto)
      .match(
        /^(\d{4}-\d{2}-\d{2})/
      );

  return match
    ? match[1]
    : null;

}


function attr(
  node,
  name
) {

  if (
    !node ||
    typeof node !== "object"
  ) {
    return null;
  }

  return (
    node[`@_${name}`] ??
    null
  );

}


function sha256(value) {

  return crypto
    .createHash(
      "sha256"
    )
    .update(
      String(value)
    )
    .digest(
      "hex"
    );

}


// ============================================================
// SOLO EMPRESAS / PERSONAS JURÍDICAS
// ============================================================

function isLegalEntityNif(nif) {

  /*
   * Evitamos DNI y NIE.
   *
   * Incluye formas habituales:
   *
   * A SA
   * B SL
   * C Colectivas
   * D Comanditarias
   * E Comunidades bienes
   * F Cooperativas
   * G Asociaciones
   * H Comunidades propietarios
   * J Sociedades civiles
   * N Entidades extranjeras
   * P Corporaciones locales
   * Q Organismos públicos
   * R Congregaciones
   * S Administración
   * U UTE
   * V Otros
   * W Establecimientos no residentes
   */

  return (
    /^[ABCDEFGHJNPQRSUVW][0-9]{7}[A-Z0-9]$/
      .test(nif)
  );

}


// ============================================================
// URL
// ============================================================

function resolveUrl(
  href,
  baseUrl
) {

  if (!href) {
    return null;
  }

  try {

    return new URL(
      href,
      baseUrl
    ).toString();

  }
  catch {

    return href;

  }

}


function getFeedLink(
  node,
  rel,
  baseUrl
) {

  const links =
    asArray(
      node?.link
    );

  for (
    const link
    of links
  ) {

    const relation =
      cleanText(
        attr(
          link,
          "rel"
        ) || ""
      );

    const href =
      cleanText(
        attr(
          link,
          "href"
        ) || ""
      );

    if (!href) {
      continue;
    }

    if (rel) {

      if (
        relation === rel
      ) {

        return resolveUrl(
          href,
          baseUrl
        );

      }

    }
    else {

      if (!relation) {

        return resolveUrl(
          href,
          baseUrl
        );

      }

    }

  }

  return null;

}


function getEntryUrl(
  entry,
  baseUrl
) {

  return (

    getFeedLink(
      entry,
      "alternate",
      baseUrl
    )

    ||

    getFeedLink(
      entry,
      null,
      baseUrl
    )

    ||

    getFeedLink(
      entry,
      "self",
      baseUrl
    )

    ||

    null

  );

}


// ============================================================
// BUSCAR CONTRACTFOLDERSTATUS
// ============================================================

function getContractFolderStatuses(
  entry
) {

  const encontrados = [];


  function recorrer(node) {

    if (
      !node ||
      typeof node !== "object"
    ) {
      return;
    }


    if (
      node.ContractFolderStatus
    ) {

      encontrados.push(
        ...asArray(
          node.ContractFolderStatus
        )
      );

    }


    for (
      const value
      of Object.values(node)
    ) {

      if (
        !value ||
        typeof value !== "object"
      ) {
        continue;
      }


      if (
        Array.isArray(value)
      ) {

        for (
          const elemento
          of value
        ) {

          recorrer(
            elemento
          );

        }

      }
      else {

        recorrer(
          value
        );

      }

    }

  }


  recorrer(entry);


  return [
    ...new Set(
      encontrados
    )
  ];

}


// ============================================================
// NIF ADJUDICATARIO
// ============================================================

function getWinningPartyNif(
  winningParty
) {

  const identificaciones =
    asArray(
      winningParty
        ?.PartyIdentification
    );


  /*
   * Primero buscamos
   * schemeName=NIF
   */

  for (
    const identificacion
    of identificaciones
  ) {

    const id =
      identificacion?.ID;

    const scheme =
      cleanText(
        attr(
          id,
          "schemeName"
        ) || ""
      )
        .toUpperCase();


    if (
      scheme !== "NIF"
    ) {
      continue;
    }


    const nif =
      cleanNif(
        scalar(id)
      );


    if (
      isLegalEntityNif(nif)
    ) {
      return nif;
    }

  }


  /*
   * Fallback:
   * si no existe schemeName,
   * únicamente aceptamos
   * estructura de NIF jurídico.
   */

  for (
    const identificacion
    of identificaciones
  ) {

    const id =
      identificacion?.ID;

    const scheme =
      cleanText(
        attr(
          id,
          "schemeName"
        ) || ""
      );


    if (scheme) {
      continue;
    }


    const nif =
      cleanNif(
        scalar(id)
      );


    if (
      isLegalEntityNif(nif)
    ) {
      return nif;
    }

  }


  return "";

}


// ============================================================
// NOMBRE ADJUDICATARIO
// ============================================================

function getWinningPartyName(
  winningParty
) {

  return cleanText(

    scalar(
      winningParty
        ?.PartyName
        ?.Name
    )

    ||

    scalar(
      winningParty
        ?.PartyLegalEntity
        ?.RegistrationName
    )

    ||

    ""

  );

}


// ============================================================
// ORGANISMO CONTRATANTE
// ============================================================

function getBuyerName(
  status
) {

  const party =

    status
      ?.LocatedContractingParty
      ?.Party

    ||

    status
      ?.ContractingParty
      ?.Party

    ||

    {};


  return cleanText(

    scalar(
      party
        ?.PartyName
        ?.Name
    )

    ||

    scalar(
      party
        ?.PartyLegalEntity
        ?.RegistrationName
    )

    ||

    ""

  );

}


// ============================================================
// EXPEDIENTE
// ============================================================

function getExpediente(
  status,
  entry
) {

  return cleanText(

    scalar(
      status
        ?.ContractFolderID
    )

    ||

    scalar(
      entry?.id
    )

    ||

    ""

  );

}


// ============================================================
// OBJETO CONTRATO
// ============================================================

function getObjeto(
  status,
  entry
) {

  return cleanText(

    scalar(
      status
        ?.ProcurementProject
        ?.Name
    )

    ||

    scalar(
      status
        ?.ProcurementProject
        ?.Description
    )

    ||

    scalar(
      entry?.title
    )

    ||

    ""

  );

}


// ============================================================
// TIPO CONTRATO
// ============================================================

function getTipoContrato(
  status
) {

  return cleanText(

    scalar(
      status
        ?.ProcurementProject
        ?.TypeCode
    )

    ||

    ""

  );

}


// ============================================================
// PROCEDIMIENTO
// ============================================================

function getProcedimiento(
  status
) {

  return cleanText(

    scalar(
      status
        ?.TenderingProcess
        ?.ProcedureCode
    )

    ||

    ""

  );

}


// ============================================================
// CPV
// ============================================================

function getCpv(
  status
) {

  const project =
    status
      ?.ProcurementProject
    ||
    {};


  const principal =
    scalar(
      project
        ?.MainCommodityClassification
        ?.ItemClassificationCode
    );


  if (principal) {

    return cleanText(
      principal
    );

  }


  const adicionales =
    asArray(
      project
        ?.AdditionalCommodityClassification
    );


  for (
    const item
    of adicionales
  ) {

    const codigo =
      scalar(
        item
          ?.ItemClassificationCode
      );


    if (codigo) {

      return cleanText(
        codigo
      );

    }

  }


  return "";

}


// ============================================================
// LOCALIZACIÓN
// ============================================================

function getLocation(
  status
) {

  const project =
    status
      ?.ProcurementProject
    ||
    {};


  const location =

    project
      ?.RealizedLocation

    ||

    asArray(
      project
        ?.RequiredCommodityLocation
    )[0]

    ||

    {};


  const address =
    location
      ?.Address
    ||
    {};


  return {

    municipio:

      cleanText(

        scalar(
          address
            ?.CityName
        )

        ||

        ""

      ),


    provincia:

      cleanText(

        scalar(
          address
            ?.CountrySubentity
        )

        ||

        scalar(
          address
            ?.CountrySubentityCode
        )

        ||

        ""

      )

  };

}


// ============================================================
// PRESUPUESTO LICITACIÓN
// ============================================================

function getPresupuesto(
  status
) {

  return (

    numberValue(

      status
        ?.ProcurementProject
        ?.BudgetAmount
        ?.TaxExclusiveAmount

    )

    ??

    null

  );

}


// ============================================================
// IMPORTE ADJUDICACIÓN SIN IVA
// ============================================================

function getImporteSinIva(
  result
) {

  const monetary =

    result
      ?.AwardedTenderedProject
      ?.LegalMonetaryTotal

    ||

    result
      ?.AwardedTenderProject
      ?.LegalMonetaryTotal

    ||

    {};


  return (

    numberValue(
      monetary
        ?.TaxExclusiveAmount
    )

    ??

    numberValue(
      result
        ?.AwardedTenderedProject
        ?.TaxExclusiveAmount
    )

    ??

    null

  );

}


// ============================================================
// IMPORTE ADJUDICACIÓN CON IVA
// ============================================================

function getImporteConIva(
  result
) {

  const monetary =

    result
      ?.AwardedTenderedProject
      ?.LegalMonetaryTotal

    ||

    result
      ?.AwardedTenderProject
      ?.LegalMonetaryTotal

    ||

    {};


  return (

    numberValue(
      monetary
        ?.PayableAmount
    )

    ??

    numberValue(
      monetary
        ?.TaxInclusiveAmount
    )

    ??

    null

  );

}


// ============================================================
// LOTE
// ============================================================

function getLote(
  result
) {

  return cleanText(

    scalar(
      result
        ?.AwardedTenderedProject
        ?.ProcurementProjectLotID
    )

    ||

    scalar(
      result
        ?.AwardedTenderProject
        ?.ProcurementProjectLotID
    )

    ||

    scalar(
      result
        ?.ProcurementProjectLotID
    )

    ||

    ""

  );

}


// ============================================================
// ID CONTRATO
// ============================================================

function getContractId(
  result
) {

  const contracts =
    asArray(
      result?.Contract
    );


  for (
    const contract
    of contracts
  ) {

    const id =
      scalar(
        contract?.ID
      );


    if (id) {

      return cleanText(
        id
      );

    }

  }


  return "";

}


// ============================================================
// FECHA FORMALIZACIÓN
// ============================================================

function getFormalizacion(
  result
) {

  const contracts =
    asArray(
      result?.Contract
    );


  for (
    const contract
    of contracts
  ) {

    const fecha =
      dateOnly(
        contract
          ?.IssueDate
      );


    if (fecha) {
      return fecha;
    }

  }


  return null;

}


// ============================================================
// UTE
// ============================================================

function getEsUte(
  result
) {

  const code =
    cleanText(

      scalar(
        result
          ?.WinningParty
          ?.PartyLegalEntity
          ?.CompanyTypeCode
      )

      ||

      ""

    )
      .toUpperCase();


  if (!code) {
    return false;
  }


  return code.includes(
    "UTE"
  );

}


// ============================================================
// CLAVE ANTIDUPLICADOS
// ============================================================

function createDedupeKey({
  expediente,
  lote,
  nif,
  contractId
}) {

  return sha256(

    [
      "PLACSP",
      expediente || "",
      lote || "",
      nif || "",
      contractId || ""
    ]
      .join("|")

  );

}


// ============================================================
// EXTRAER UNA ADJUDICACIÓN
// ============================================================

function parseTenderResult(
  status,
  entry,
  result,
  feedUrl
) {

  const winningParty =
    result
      ?.WinningParty;


  if (!winningParty) {
    return null;
  }


  const nif =
    getWinningPartyNif(
      winningParty
    );


  const nombre =
    getWinningPartyName(
      winningParty
    );


  /*
   * No guardamos
   * particulares.
   */

  if (
    !nif ||
    !nombre
  ) {

    return null;

  }


  const expediente =
    getExpediente(
      status,
      entry
    );


  const lote =
    getLote(
      result
    );


  const contractId =
    getContractId(
      result
    );


  const location =
    getLocation(
      status
    );


  const fechaAdjudicacion =

    dateOnly(
      result?.AwardDate
    )

    ||

    dateOnly(
      entry?.updated
    );


  const sourceId =
    cleanText(
      scalar(
        entry?.id
      ) || ""
    );


  const dedupeKey =
    createDedupeKey({

      expediente,
      lote,
      nif,
      contractId

    });


  return {

    nif,

    nombre,


    contrato: {

      empresa_nif:
        nif,

      empresa_nombre:
        nombre,


      organismo_nombre:

        getBuyerName(
          status
        )

        ||

        null,


      expediente:

        expediente

        ||

        null,


      objeto:

        getObjeto(
          status,
          entry
        )

        ||

        null,


      lote:

        lote

        ||

        null,


      tipo_contrato:

        getTipoContrato(
          status
        )

        ||

        null,


      procedimiento:

        getProcedimiento(
          status
        )

        ||

        null,


      cpv:

        getCpv(
          status
        )

        ||

        null,


      fecha_publicacion:

        dateOnly(
          entry?.published
        )

        ||

        dateOnly(
          entry?.updated
        ),


      fecha_adjudicacion:

        fechaAdjudicacion,


      fecha_formalizacion:

        getFormalizacion(
          result
        ),


      importe_licitacion:

        getPresupuesto(
          status
        ),


      importe_adjudicacion_sin_iva:

        getImporteSinIva(
          result
        ),


      importe_adjudicacion_con_iva:

        getImporteConIva(
          result
        ),


      numero_ofertas:

        integerValue(
          result
            ?.ReceivedTenderQuantity
        ),


      es_pyme:

        booleanValue(
          result
            ?.SMEAwardedIndicator
        ),


      es_ute:

        getEsUte(
          result
        ),


      municipio:

        location
          .municipio

        ||

        null,


      provincia:

        location
          .provincia

        ||

        null,


      url_oficial:

        getEntryUrl(
          entry,
          feedUrl
        ),


      fuente:

        "PLACSP",


      source_id:

        sourceId

        ||

        null,


      dedupe_key:

        dedupeKey,


      raw_data: {

        contract_id:
          contractId || null,

        tender_result:
          result

      },


      publicada:

        true

    }

  };

}


// ============================================================
// GUARDAR EMPRESA
// ============================================================

async function upsertEmpresa(
  nif,
  nombre
) {

  if (DRY_RUN) {

    return {
      id: null,
      nif,
      nombre
    };

  }


  const {
    data,
    error
  } =

    await supabase

      .from(
        "bh_empresas_publicas"
      )

      .upsert(

        {

          nif,
          nombre,
          activa: true

        },

        {

          onConflict:
            "nif",

          ignoreDuplicates:
            false

        }

      )

      .select(
        "id,nif,nombre"
      )

      .single();


  if (error) {

    throw new Error(

      `Error guardando empresa ${nif}: ${error.message}`

    );

  }


  return data;

}


// ============================================================
// GUARDAR CONTRATO
// ============================================================

async function upsertContrato(
  empresaId,
  contrato
) {

  if (DRY_RUN) {
    return;
  }


  const payload = {

    ...contrato,

    empresa_id:
      empresaId

  };


  const {
    error
  } =

    await supabase

      .from(
        "bh_contratos_publicos"
      )

      .upsert(

        payload,

        {

          onConflict:
            "dedupe_key",

          ignoreDuplicates:
            false

        }

      );


  if (error) {

    throw new Error(

      `Error guardando contrato ${contrato.expediente || "sin expediente"}: ${error.message}`

    );

  }

}


// ============================================================
// RECALCULAR TOTALES
// ============================================================

async function actualizarTotalesEmpresa(
  empresaId
) {

  if (
    DRY_RUN ||
    !empresaId
  ) {
    return;
  }


  const {
    error
  } =

    await supabase
      .rpc(

        "bh_actualizar_totales_empresa",

        {

          p_empresa_id:
            empresaId

        }

      );


  if (error) {

    throw new Error(

      `Error recalculando empresa ${empresaId}: ${error.message}`

    );

  }

}


// ============================================================
// DESCARGAR PLACSP
// ============================================================

async function descargarXml(
  url
) {

  console.log(
    `⬇️ Descargando ${url}`
  );


  const response =
    await fetch(
      url,
      {

        headers: {

          "User-Agent":
            "BoletinHoy/1.0 (boletinhoy.es)",

          "Accept":
            "application/atom+xml, application/xml, text/xml"

        }

      }
    );


  if (
    !response.ok
  ) {

    throw new Error(

      `PLACSP respondió HTTP ${response.status}`

    );

  }


  return response.text();

}


// ============================================================
// PROCESAR ENTRY
// ============================================================

async function procesarEntry(
  entry,
  feedUrl,
  touchedCompanies
) {

  const statuses =
    getContractFolderStatuses(
      entry
    );


  let detected = 0;
  let stored = 0;


  for (
    const status
    of statuses
  ) {

    const tenderResults =
      asArray(
        status?.TenderResult
      );


    for (
      const result
      of tenderResults
    ) {

      const parsed =
        parseTenderResult(

          status,
          entry,
          result,
          feedUrl

        );


      if (!parsed) {
        continue;
      }


      detected++;


      if (DRY_RUN) {

        console.log(

          `[DRY] ${parsed.nif} | ${parsed.nombre} | ${parsed.contrato.expediente || "-"}`

        );

        continue;

      }


      const empresa =
        await upsertEmpresa(

          parsed.nif,
          parsed.nombre

        );


      await upsertContrato(

        empresa.id,
        parsed.contrato

      );


      touchedCompanies.add(
        empresa.id
      );


      stored++;

    }

  }


  return {

    detected,
    stored

  };

}


// ============================================================
// PROCESAR PÁGINA ATOM
// ============================================================

async function procesarPagina(
  url,
  touchedCompanies
) {

  const xml =
    await descargarXml(
      url
    );


  const document =
    parser.parse(
      xml
    );


  const feed =
    document?.feed;


  if (!feed) {

    throw new Error(

      "El documento recibido no contiene un feed ATOM válido."

    );

  }


  const entries =
    asArray(
      feed.entry
    );


  console.log(
    `📄 Entradas encontradas: ${entries.length}`
  );


  let detected = 0;
  let stored = 0;


  for (
    const entry
    of entries
  ) {

    const result =
      await procesarEntry(

        entry,
        url,
        touchedCompanies

      );


    detected +=
      result.detected;


    stored +=
      result.stored;

  }


  /*
   * Para ir desde el feed actual
   * hacia páginas antiguas.
   *
   * La documentación oficial
   * muestra rel="prev".
   *
   * También soportamos
   * "previous" por seguridad.
   */

  const previousUrl =

  getFeedLink(
    feed,
    "next",
    url
  )

  ||

  null;

  return {

    previousUrl,

    detected,

    stored,

    updated:
      scalar(
        feed.updated
      )

  };

}


// ============================================================
// MAIN
// ============================================================

async function main() {

  console.log("");
  console.log(
    "==============================================="
  );

  console.log(
    " BOLETÍNHOY · IMPORTADOR PLACSP"
  );

  console.log(
    "==============================================="
  );

  console.log(
    `Páginas máximas: ${PLACSP_MAX_PAGES}`
  );

  console.log(
    `Espera: ${PLACSP_DELAY_MS} ms`
  );

  console.log(
    `DRY_RUN: ${DRY_RUN}`
  );

  console.log(
    "Solo personas jurídicas: SÍ"
  );

  console.log(
    "==============================================="
  );

  console.log("");


  let currentUrl =
    PLACSP_START_FEED;


  let page = 0;


  let totalDetected = 0;

  let totalStored = 0;


  const touchedCompanies =
    new Set();


  const visitedUrls =
    new Set();


  while (

    currentUrl

    &&

    page <
      PLACSP_MAX_PAGES

  ) {


    if (
      visitedUrls
        .has(
          currentUrl
        )
    ) {

      console.warn(

        "⚠️ URL repetida. Deteniendo paginación."

      );

      break;

    }


    visitedUrls.add(
      currentUrl
    );


    page++;


    console.log("");

    console.log(
      `---------- PÁGINA ${page}/${PLACSP_MAX_PAGES} ----------`
    );


    const result =
      await procesarPagina(

        currentUrl,
        touchedCompanies

      );


    totalDetected +=
      result.detected;


    totalStored +=
      result.stored;


    console.log(

      `🕒 Actualización feed: ${result.updated || "sin fecha"}`

    );


    console.log(

      `🏢 Adjudicaciones de empresas detectadas: ${result.detected}`

    );


    if (!DRY_RUN) {

      console.log(

        `💾 Adjudicaciones guardadas/actualizadas: ${result.stored}`

      );

    }


    currentUrl =
      result.previousUrl;


    if (

      currentUrl

      &&

      page <
        PLACSP_MAX_PAGES

      &&

      PLACSP_DELAY_MS > 0

    ) {

      await sleep(
        PLACSP_DELAY_MS
      );

    }

  }


// ============================================================
// ACTUALIZAR TOTALES EMPRESAS
// ============================================================

  if (!DRY_RUN) {

    console.log("");

    console.log(

      `🔄 Recalculando ${touchedCompanies.size} empresas...`

    );


    let procesadas = 0;


    for (
      const empresaId
      of touchedCompanies
    ) {

      await actualizarTotalesEmpresa(
        empresaId
      );


      procesadas++;


      if (

        procesadas % 50 === 0

        ||

        procesadas ===
          touchedCompanies.size

      ) {

        console.log(

          `   ${procesadas}/${touchedCompanies.size}`

        );

      }

    }

  }


// ============================================================
// RESUMEN
// ============================================================

  console.log("");

  console.log(
    "==============================================="
  );

  console.log(
    " ✅ IMPORTACIÓN FINALIZADA"
  );

  console.log(
    "==============================================="
  );

  console.log(
    `Páginas procesadas: ${page}`
  );

  console.log(
    `Adjudicaciones detectadas: ${totalDetected}`
  );


  if (!DRY_RUN) {

    console.log(

      `Adjudicaciones guardadas/actualizadas: ${totalStored}`

    );

    console.log(

      `Empresas afectadas: ${touchedCompanies.size}`

    );

  }


  console.log(
    "==============================================="
  );

  console.log("");

}


// ============================================================
// EJECUTAR
// ============================================================

main()

  .catch(

    error => {

      console.error("");

      console.error(
        "❌ ERROR FATAL EN importar-placsp.js"
      );

      console.error(
        error
      );

      console.error("");

      process.exit(1);

    }

  );
