import * as cheerio from "cheerio";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0)";

const SECTORES = {
  "Oposiciones y Empleo": {
    threshold: 8,
    seccionesPreferidas: [
      "oposiciones, concursos y otras convocatorias"
    ],
    seccionesExcluidas: [
      "nombramientos, situaciones e incidencias"
    ],
    fuertes: [
      { texto: "se convoca proceso selectivo", puntos: 10 },
      { texto: "convocatoria de pruebas selectivas", puntos: 10 },
      { texto: "se convocan pruebas selectivas", puntos: 10 },
      { texto: "convocatoria para el acceso", puntos: 9 },
      { texto: "convocatoria para ingreso", puntos: 9 },
      { texto: "convocatoria de concurso-oposicion", puntos: 10 },
      { texto: "se convoca concurso-oposicion", puntos: 10 },
      { texto: "creacion de una bolsa de trabajo", puntos: 10 },
      { texto: "ampliacion de la bolsa de trabajo", puntos: 10 },
      { texto: "se convoca la bolsa", puntos: 9 },
      { texto: "bolsa extraordinaria", puntos: 9 },
      { texto: "bolsa unica", puntos: 8 },
      { texto: "oferta de empleo publico", puntos: 9 },
      { texto: "sistema general de acceso libre", puntos: 8 },
      { texto: "turno libre", puntos: 7 },
      { texto: "oposicion libre", puntos: 9 },
      { texto: "plazas de personal funcionario de carrera", puntos: 9 },
      { texto: "plazas de personal laboral fijo", puntos: 9 },
      { texto: "seleccion temporal", puntos: 8 },
      { texto: "contratacion temporal", puntos: 7 },
      { texto: "contratos laborales en el marco de proyectos", puntos: 7 }
    ],
    medias: [
      { texto: "proceso selectivo", puntos: 4 },
      { texto: "pruebas selectivas", puntos: 4 },
      { texto: "concurso-oposicion", puntos: 5 },
      { texto: "bolsa de trabajo", puntos: 5 },
      { texto: "bolsa de empleo", puntos: 5 },
      { texto: "aspirantes", puntos: 2 },
      { texto: "personas admitidas y excluidas", puntos: 3 },
      { texto: "tribunal calificador", puntos: 3 },
      { texto: "bases de la convocatoria", puntos: 4 },
      { texto: "plazo de presentacion de solicitudes", puntos: 4 },
      { texto: "acceso libre", puntos: 4 },
      { texto: "promocion interna", points: 2 },
      { texto: "personal funcionario", points: 2 },
      { texto: "personal laboral", points: 2 },
      { texto: "personal estatutario", points: 2 },
      { texto: "plazas vacantes", puntos: 2 },
      { texto: "presentacion de solicitudes", puntos: 3 },
      { texto: "tasa de examen", puntos: 3 }
    ],
    combinaciones: [
      { todos: ["convoca", "plaza", "acceso libre"], puntos: 7 },
      { todos: ["convoca", "bolsa", "seleccion temporal"], puntos: 8 },
      { todos: ["proceso selectivo", "presentacion de solicitudes"], puntos: 7 },
      { todos: ["bases", "plazas", "oposicion"], puntos: 8 },
      { todos: ["concurso", "creacion", "bolsa de trabajo"], puntos: 8 }
    ],
    negativas: [
      { texto: "se nombra personal funcionario", puntos: -12 },
      { texto: "se nombra personal estatutario fijo", puntos: -12 },
      { texto: "nombramiento de funcionarios", puntos: -10 },
      { texto: "adjudicacion de destinos", puntos: -10 },
      { texto: "peticion de destino", puntos: -6 },
      { texto: "toma de posesion", puntos: -10 },
      { texto: "cese", puntos: -8 },
      { texto: "declarar jubilacion", puntos: -10 },
      { texto: "lista definitiva de personas que superan", puntos: -5 },
      { texto: "personas seleccionadas", puntos: -4 },
      { texto: "carrera profesional", puntos: -8 },
      { texto: "evaluacion del desempeno", puntos: -7 },
      { texto: "libre designacion", puntos: -4 },
      { texto: "puesto de trabajo de caracter directivo", puntos: -5 },
      { texto: "cargo intermedio", puntos: -5 }
    ],
    excluirSiContiene: [
      "procedimiento disciplinario",
      "expediente disciplinario",
      "sentencia judicial",
      "ejecucion de sentencia"
    ]
  },
  "Agricultura y Ganadería": {
    threshold: 8,
    fuertes: [
      { texto: "ayudas a las explotaciones agrarias", puntos: 10 },
      { texto: "modernizacion de explotaciones agrarias", puntos: 10 },
      { texto: "incorporacion de jovenes agricultores", puntos: 10 },
      { texto: "politica agricola comun", puntos: 8 },
      { texto: "pago basico", puntos: 7 },
      { texto: "ayudas directas de la pac", puntos: 10 },
      { texto: "desarrollo rural", puntos: 5 },
      { texto: "produccion ecologica", puntos: 6 },
      { texto: "agricultura ecologica", puntos: 7 },
      { texto: "explotaciones ganaderas", puntos: 7 },
      { texto: "sanidad animal", puntos: 6 },
      { texto: "sanidad vegetal", puntos: 6 },
      { texto: "seguros agrarios", puntos: 7 },
      { texto: "regadios", puntos: 6 },
      { texto: "sector pesquero", puntos: 7 },
      { texto: "sector acuicola", puntos: 7 },
      { texto: "flota pesquera", puntos: 6 },
      { texto: "acuicultura marina", puntos: 7 }
    ],
    medias: [
      { texto: "agricultura", puntos: 2 },
      { texto: "ganaderia", puntos: 2 },
      { texto: "pesca", puntos: 2 },
      { texto: "acuicultura", puntos: 3 },
      { texto: "explotacion agraria", puntos: 3 },
      { texto: "explotacion ganadera", puntos: 3 },
      { texto: "agricultor", puntos: 2 },
      { texto: "ganadero", puntos: 2 },
      { texto: "olivar", puntos: 2 },
      { texto: "vino", puntos: 1 },
      { texto: "vinedo", puntos: 2 },
      { texto: "apicultura", puntos: 3 },
      { texto: "ovino", puntos: 2 },
      { texto: "caprino", puntos: 2 },
      { texto: "bovino", puntos: 2 },
      { texto: "porcino", puntos: 2 },
      { texto: "feader", puntos: 4 },
      { texto: "fondo europeo agricola", puntos: 5 }
    ],
    combinaciones: [
      { todos: ["convocatoria", "ayudas", "explotaciones agrarias"], puntos: 9 },
      { todos: ["subvenciones", "jovenes agricultores"], puntos: 9 },
      { todos: ["bases reguladoras", "sector pesquero"], puntos: 8 },
      { todos: ["ayudas", "produccion ecologica"], puntos: 8 }
    ],
    negativas: [
      { texto: "procedimiento sancionador", puntos: -12 },
      { texto: "expediente sancionador", puntos: -12 },
      { texto: "acto administrativo relativo", puntos: -6 },
      { texto: "no ha sido posible notificar", puntos: -10 },
      { texto: "notificacion por comparecencia", puntos: -10 },
      { texto: "infraccion en materia de aguas", puntos: -8 },
      { texto: "autorizacion ambiental", puntos: -5 },
      { texto: "deslinde de via pecuaria", puntos: -5 }
    ],
    excluirSiContiene: [
      "procedimiento sancionador en materia de agricultura",
      "procedimiento sancionador en materia de ganaderia",
      "procedimiento sancionador en materia de pesca",
      "procedimiento sancionador en materia de sanidad vegetal"
    ]
  },
  "Licitaciones y Contratación": {
    threshold: 8,
    seccionesPreferidas: [
      "licitaciones publicas y adjudicaciones"
    ],
    fuertes: [
      { texto: "anuncio de licitacion", puntos: 10 },
      { texto: "convocatoria de licitacion", puntos: 10 },
      { texto: "procedimiento abierto", puntos: 8 },
      { texto: "procedimiento abierto simplificado", puntos: 9 },
      { texto: "contratacion de obras", puntos: 8 },
      { texto: "contrato de obras", puntos: 7 },
      { texto: "contrato de servicios", puntos: 6 },
      { texto: "contrato de suministro", puntos: 6 },
      { texto: "pliego de clausulas administrativas particulares", puntos: 8 },
      { texto: "pliego de prescripciones tecnicas", puntos: 8 },
      { texto: "presentacion de ofertas", puntos: 8 },
      { texto: "presupuesto base de licitacion", puntos: 9 },
      { texto: "valor estimado del contrato", puntos: 8 },
      { texto: "perfil de contratante", puntos: 8 },
      { texto: "expediente de contratacion", puntos: 6 }
    ],
    medias: [
      { texto: "licitacion", puntos: 4 },
      { texto: "contratacion publica", puntos: 4 },
      { texto: "adjudicatario", puntos: 2 },
      { texto: "mesa de contratacion", puntos: 4 },
      { texto: "oferta economica", puntos: 3 },
      { texto: "criterios de adjudicacion", puntos: 4 },
      { texto: "solvencia economica", puntos: 3 },
      { texto: "solvencia tecnica", puntos: 3 },
      { texto: "lote", puntos: 1 },
      { texto: "canon", puntos: 1 }
    ],
    combinaciones: [
      { todos: ["contrato", "presentacion de ofertas"], puntos: 8 },
      { todos: ["licitacion", "presupuesto base"], puntos: 8 },
      { todos: ["proceso abierto", "valor estimado"], puntos: 8 }
    ],
    negativas: [
      { texto: "formalizacion del contrato", puntos: -7 },
      { texto: "adjudicacion del contrato", puntos: -5 },
      { texto: "contrato ya adjudicado", puntos: -8 },
      { texto: "prorroga del contrato", puntos: -10 },
      { texto: "contrato de arrendamiento", puntos: -8 },
      { texto: "adjudicacion directa", puntos: -6 },
      { texto: "desierto el procedimiento", puntos: -5 },
      { texto: "resolucion del contrato", puntos: -8 }
    ],
    excluirSiContiene: [
      "prorroga del contrato de arrendamiento",
      "formalizacion de la prorroga",
      "resolucion de prorroga"
    ]
  },
  "Educación y Universidades": {
    threshold: 8,
    fuertes: [
      { texto: "becas y ayudas al estudio", puntos: 9 },
      { texto: "convocatoria de becas", puntos: 9 },
      { texto: "convocatoria de ayudas al estudio", puntos: 9 },
      { texto: "formacion profesional para el empleo", puntos: 7 },
      { texto: "subvenciones para planes de formacion", puntos: 8 },
      { texto: "oferta educativa", puntos: 6 },
      { texto: "oferta de ciclos formativos", puntos: 7 },
      { texto: "admision del alumnado", puntos: 6 },
      { texto: "escolarizacion del alumnado", puntos: 6 },
      { texto: "cuerpo de maestros", puntos: 6 },
      { texto: "profesores de ensenanza secundaria", puntos: 6 },
      { texto: "personal docente", puntos: 5 },
      { texto: "universidades publicas", puntos: 5 }
    ],
    medias: [
      { texto: "educacion infantil", puntos: 3 },
      { texto: "educacion primaria", puntos: 3 },
      { texto: "educacion secundaria", puntos: 3 },
      { texto: "bachillerato", puntos: 3 },
      { texto: "formacion profesional", puntos: 3 },
      { texto: "centro docente", puntos: 2 },
      { texto: "centros educativos", puntos: 2 },
      { texto: "universidad", puntos: 2 },
      { texto: "alumnado", puntos: 2 },
      { texto: "profesorado", puntos: 2 },
      { texto: "curso academico", puntos: 2 },
      { texto: "matricula", puntos: 2 }
    ],
    combinaciones: [
      { todos: ["convocatoria", "becas"], puntos: 8 },
      { todos: ["subvenciones", "planes de formacion"], puntos: 8 },
      { todos: ["admision", "centros docentes"], puntos: 7 },
      { todos: ["convoca", "plazas", "profesorado"], puntos: 8 }
    ],
    negativas: [
      { texto: "reintegro de becas", puntos: -12 },
      { texto: "cantidades indebidamente percibidas", puntos: -10 },
      { texto: "procedimiento de reintegro", puntos: -10 },
      { texto: "no ha sido posible notificar", puntos: -9 },
      { texto: "autorizacion de centro docente privado", puntos: -5 },
      { texto: "cambio de titularidad", puntos: -7 },
      { texto: "extincion de la autorizacion", puntos: -7 },
      { texto: "procedimiento sancionador", puntos: -9 }
    ],
    excluirSiContiene: [
      "reintegro de becas y ayudas al estudio",
      "declaracion de cantidades indebidamente percibidas"
    ]
  },
  "Sanidad y Asuntos Sociales": {
    threshold: 8,
    fuertes: [
      { texto: "prestacion de dependencia", puntos: 7 },
      { texto: "atencion a la dependencia", puntos: 6 },
      { texto: "renta minima de insercion social", puntos: 7 },
      { texto: "ingreso minimo vital", puntos: 8 },
      { texto: "subvenciones a entidades sociales", puntos: 9 },
      { texto: "programas de interes general con cargo a la asignacion tributaria", puntos: 9 },
      { texto: "centros de servicios sociales", puntos: 6 },
      { texto: "ayuda a domicilio", puntos: 7 },
      { texto: "personas con discapacidad", puntos: 5 },
      { texto: "centros residenciales", puntos: 5 },
      { texto: "prestaciones sociales", puntos: 6 },
      { texto: "concurso de traslado", puntos: 6 }
    ],
    medias: [
      { texto: "sanidad", puntos: 2 },
      { texto: "hospital", puntos: 2 },
      { texto: "centro de salud", puntos: 2 },
      { texto: "atencion primaria", puntos: 3 },
      { texto: "personal estatutario", puntos: 3 },
      { texto: "dependencia", puntos: 2 },
      { texto: "servicios sociales", puntos: 3 },
      { texto: "discapacidad", puntos: 3 },
      { texto: "entidades del tercer sector", puntos: 4 },
      { texto: "inclusion social", puntos: 2 },
      { texto: "familias", puntos: 1 }
    ],
    combinaciones: [
      { todos: ["convocatoria", "subvenciones", "entidades sociales"], puntos: 9 },
      { todos: ["ayudas", "personas con discapacidad"], puntos: 8 },
      { todos: ["prestaciones", "dependencia"], puntos: 7 }
    ],
    negativas: [
      { texto: "no ha sido posible notificar", puntos: -12 },
      { texto: "notificacion por edicto", puntos: -10 },
      { texto: "relacion de solicitantes", puntos: -6 },
      { texto: "actos administrativos", puntos: -7 },
      { texto: "procedimiento sancionador", puntos: -10 },
      { texto: "expediente administrativo requerido", puntos: -8 },
      { texto: "remision del expediente", puntos: -8 },
      { texto: "reintegro de prestaciones", puntos: -8 },
      { texto: "indebidamente percibidas", puntos: -10 }
    ],
    excluirSiContiene: [
      "a los que no ha sido posible notificar",
      "relacion de nif",
      "relacion de solicitantes de reconocimiento de la situacion de dependencia"
    ]
  },
  "Subvenciones y Ayudas": {
    threshold: 9,
    fuertes: [
      { texto: "se convocan subvenciones", puntos: 10 },
      { texto: "se convocan ayudas", puntos: 10 },
      { texto: "convocatoria de subvenciones", puntos: 10 },
      { texto: "convocatoria de ayudas", puntos: 10 },
      { texto: "bases reguladoras para la concesion de subvenciones", puntos: 9 },
      { texto: "extracto de la convocatoria", puntos: 9 },
      { texto: "en regimen de concurrencia competitiva", puntos: 6 },
      { texto: "en regimen de concurrencia no competitiva", puntos: 6 },
      { texto: "personas o entidades beneficiarias", puntos: 5 },
      { texto: "plazo de presentacion de solicitudes", puntos: 5 },
      { texto: "digitalizacion de pymes", puntos: 8 },
      { texto: "fomento del empleo autonomo", puntos: 8 },
      { texto: "ayudas a trabajadores autonomos", puntos: 9 },
      { texto: "creacion de empresas", puntos: 6 },
      { texto: "incentivos economicos", puntos: 8 },
      { texto: "i+d+i empresarial", puntos: 7 }
    ],
    medias: [
      { texto: "subvencion", puntos: 2 },
      { texto: "ayuda", puntos: 1 },
      { texto: "incentivo", puntos: 2 },
      { texto: "beneficiarios", puntos: 2 },
      { texto: "solicitudes", puntos: 1 },
      { texto: "bases reguladoras", puntos: 3 },
      { texto: "concurrencia competitiva", puntos: 4 },
      { texto: "credito presupuestario", puntos: 3 },
      { texto: "cuantia maxima", puntos: 3 },
      { texto: "pymes", puntos: 3 },
      { texto: "autonomos", puntos: 3 },
      { texto: "emprendimiento", puntos: 3 }
    ],
    combinaciones: [
      { todos: ["convocatoria", "subvenciones", "solicitudes"], puntos: 9 },
      { todos: ["bases reguladoras", "personas beneficiarias"], puntos: 7 },
      { todos: ["extracto", "convocatoria", "subvenciones"], puntos: 9 },
      { todos: ["ayudas", "autonomos", "plazo"], puntos: 8 }
    ],
    negativas: [
      { texto: "reintegro de subvenciones", puntos: -12 },
      { texto: "procedimiento de reintegro", puntos: -12 },
      { texto: "indebidamente percibidas", puntos: -10 },
      { texto: "concesion de subvenciones correspondiente al ejercicio", puntos: -4 },
      { texto: "resolucion de concesion", puntos: -5 },
      { texto: "relacion de beneficiarios", puntos: -6 },
      { texto: "justificacion de subvenciones", puntos: -5 },
      { texto: "perdida del derecho al cobro", puntos: -9 },
      { texto: "no ha sido posible notificar", puntos: -10 },
      { texto: "procedimiento sancionador", puntos: -10 }
    ],
    excluirSiContiene: [
      "procedimiento de reintegro de subvenciones",
      "acuerdo de inicio de reintegro",
      "cantidades indebidamente percibidas"
    ]
  },
  "Urbanismo y Medio Ambiente": {
    threshold: 8,
    fuertes: [
      { texto: "urbanismo", puntos: 9 },
      { texto: "medio ambiente", puntos: 9 },
      { texto: "plan general", puntos: 8 },
      { texto: "sostenibilidad", puntos: 8 },
      { texto: "impacto ambiental", puntos: 10 },
      { texto: "transicion ecologica", puntos: 9 }
    ],
    medias: [
      { texto: "territorio", points: 4 },
      { texto: "ambiental", points: 4 },
      { texto: "energia", points: 3 },
      { texto: "residuos", points: 4 }
    ],
    combinaciones: [
      { todos: ["evaluacion", "impacto", "ambiental"], points: 9 }
    ],
    negativas: [],
    excluirSiContiene: []
  }
};

function normalizar(texto = "") {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function clasificarTexto(texto = "", seccion = "") {
  const textoNorm = normalizar(texto);
  const seccionNorm = normalizar(seccion);
  let mejorSector = null;
  let maxPuntuacion = -999;

  for (const [nombreSector, reglas] of Object.entries(SECTORES)) {
    const tieneExclusionAbsoluta = (reglas.excluirSiContiene || []).some(ex => textoNorm.includes(normalizar(ex)));
    if (tieneExclusionAbsoluta) continue;

    const seccionExcluida = (reglas.seccionesExcluidas || []).some(secEx => seccionNorm.includes(normalizar(secEx)));
    if (seccionExcluida) continue;

    let puntuacion = 0;
    let tieneSenalPrincipal = false;

    if (reglas.seccionesPreferidas && reglas.seccionesPreferidas.some(secPref => seccionNorm.includes(normalizar(secPref)))) {
      puntuacion += 2;
    }

    for (const fuerte of (reglas.fuertes || [])) {
      if (textoNorm.includes(normalizar(fuerte.texto))) {
        puntuacion += fuerte.puntos;
        tieneSenalPrincipal = true;
      }
    }

    for (const media of (reglas.medias || [])) {
      if (textoNorm.includes(normalizar(media.texto))) {
        puntuacion += media.puntos;
      }
    }

    for (const comb of (reglas.combinaciones || [])) {
      const cumpleTodas = comb.todos.every(t => textoNorm.includes(normalizar(t)));
      if (cumpleTodas) {
        puntuacion += comb.puntos;
        tieneSenalPrincipal = true;
      }
    }

    for (const neg of (reglas.negativas || [])) {
      if (textoNorm.includes(normalizar(neg.texto))) {
        puntuacion += neg.puntos;
      }
    }

    if (!tieneSenalPrincipal && puntuacion < (reglas.threshold || 8)) {
      continue;
    }

    if (puntuacion >= (reglas.threshold || 8) && puntuacion > maxPuntuacion) {
      maxPuntuacion = puntuacion;
      mejorSector = nombreSector;
    }
  }

  return mejorSector;
}

async function supabaseRequest(endpoint, opciones = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...opciones,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(opciones.headers || {})
    }
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} - ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function ejecutarBOE() {
  console.log("🚀 Iniciando extracción mejorada del BOE...");
  const urlBoe = "https://www.boe.es/diario_boe/ultimo.php";
  let documentos = [];

  try {
    const res = await fetch(urlBoe, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.log("⚠️ No se pudo acceder a la portada del BOE.");
      return;
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    let encontradosCount = 0;

    $("a").each((_, el) => {
      const textoEnlace = $(el).text();
      const href = $(el).attr("href");

      if (href && textoEnlace.includes("PDF (BOE")) {
        encontradosCount++;
        const urlPdfIndividual = href.startsWith("http") ? href : new URL(href, "https://www.boe.es").href;

        const bloquePadre = $(el).closest("div").parent();
        let tituloTexto = bloquePadre.text()
          .replace(/PDF.*|Otros formatos.*/gi, "")
          .replace(/\s+/g, " ")
          .trim();

        if (tituloTexto && tituloTexto.length > 10) {
          const sectorEncontrado = clasificarTexto(tituloTexto, "");

          if (sectorEncontrado) {
            documentos.push({
              titulo: tituloTexto,
              url_pdf: urlPdfIndividual,
              sector: sectorEncontrado,
              origen: "BOE"
            });
          }
        }
      }
    });

    console.log(`📌 Enlaces de PDF analizados: ${encontradosCount}`);

  } catch (err) {
    console.log(`⚠️ Error al conectar con el BOE: ${err.message}`);
  }

  // Filtro local de duplicados en la misma ejecución
  const unicos = documentos.filter((documento, index, self) =>
    index === self.findIndex((t) => (
      t.url_pdf === documento.url_pdf || t.titulo === documento.titulo
    ))
  );

  console.log(`🎯 Anuncios relevantes encontrados en el BOE: ${unicos.length}`);

  for (const d of unicos) {
    try {
      // 1. Comprobamos si el anuncio ya existe en Supabase
      const existentes = await supabaseRequest(`anuncios_boja?url_pdf=eq.${encodeURIComponent(d.url_pdf)}`, {
        method: "GET"
      });

      if (existentes && existentes.length > 0) {
        console.log(`ℹ️ El anuncio ya existe en la base de datos, se omite: ${d.titulo.substring(0, 40)}...`);
        continue; 
      }

      // 2. Si no existe, lo insertamos como nuevo con enviado: false
      await supabaseRequest("anuncios_boja", {
        method: "POST",
        body: JSON.stringify({
          titulo: d.titulo,
          url_pdf: d.url_pdf,
          categoria: d.sector,
          origen: "BOE",
          enviado: false
        })
      });
      console.log(`✅ Nuevo anuncio guardado: ${d.titulo.substring(0, 40)}...`);

    } catch (err) {
      console.log(`⚠️ Aviso al guardar anuncio del BOE: ${err.message}`);
    }
  }

  return unicos;
}
export { ejecutarBOE };
