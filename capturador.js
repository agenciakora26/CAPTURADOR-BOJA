import * as cheerio from "cheerio";
import pdfParse from "pdf-parse";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0)";

const SECTORES = {
  "oposiciones y empleo": {
    threshold: 8,
    seccionesPreferidas: ["oposiciones, concursos y otras convocatorias"],
    seccionesExcluidas: ["nombramientos, situaciones e incidencias"],
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
      { texto: "contratos laborales en el marco de proyectos", puntos: 7 },
      { texto: "personal estatutario temporal", puntos: 8 }
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
      { texto: "promocion interna", puntos: 2 },
      { texto: "personal funcionario", puntos: 2 },
      { texto: "personal laboral", puntos: 2 },
      { texto: "personal estatutario", puntos: 2 },
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
  "hosteleria y comercio": {
    threshold: 8,
    fuertes: [
      { texto: "subvenciones destinadas al comercio minorista", puntos: 10 },
      { texto: "ayudas al comercio minorista", puntos: 10 },
      { texto: "subvenciones destinadas a establecimientos de hosteleria", puntos: 10 },
      { texto: "ayudas al sector hostelero", puntos: 10 },
      { texto: "sector de la hosteleria", puntos: 6 },
      { texto: "sector del comercio minorista", puntos: 7 },
      { texto: "modernizacion del comercio", puntos: 8 },
      { texto: "modernizacion de establecimientos comerciales", puntos: 9 },
      { texto: "establecimientos de restauracion", puntos: 7 },
      { texto: "establecimientos hoteleros", puntos: 7 },
      { texto: "municipio turistico", puntos: 7 },
      { texto: "empresa turistica", puntos: 6 },
      { texto: "registro de turismo", puntos: 6 },
      { texto: "calidad turistica", puntos: 6 },
      { texto: "subvencion hosteleria", puntos: 10 },
      { texto: "turismo y artesania", puntos: 7 },
      { texto: "plan de apoyo al sector hostelero", puntos: 10 },
      { texto: "calidad turistica andaluza", puntos: 8 }
    ],
    medias: [
      { texto: "hosteleria", puntos: 3 },
      { texto: "comercio minorista", puntos: 4 },
      { texto: "establecimiento comercial", puntos: 3 },
      { texto: "restauracion", puntos: 2 },
      { texto: "alojamiento turistico", puntos: 3 },
      { texto: "hotel", puntos: 1 },
      { texto: "apartamento turistico", puntos: 3 },
      { texto: "campamento de turismo", puntos: 3 },
      { texto: "agencia de viajes", puntos: 3 },
      { texto: "empresa de turismo activo", puntos: 3 },
      { texto: "artesania", puntos: 3 },
      { texto: "horarios comerciales", puntos: 5 },
      { texto: "venta ambulante", puntos: 4 }
    ],
    combinaciones: [
      { todos: ["subvencion", "hosteleria"], puntos: 8 },
      { todos: ["ayuda", "comercio minorista"], puntos: 8 },
      { todos: ["convocatoria", "establecimientos comerciales"], puntos: 7 },
      { todos: ["beneficiarios", "sector turistico"], puntos: 6 }
    ],
    negativas: [
      { texto: "procedimiento sancionador", puntos: -10 },
      { texto: "infraccion administrativa", puntos: -9 },
      { texto: "hojas de reclamaciones", puntos: -5 },
      { texto: "inspeccion de consumo", puntos: -6 },
      { texto: "notificacion por comparecencia", puntos: -8 },
      { texto: "no ha sido posible notificar", puntos: -10 },
      { texto: "reintegro de subvenciones", puntos: -6 },
      { texto: "devolucion de cantidades", puntos: -6 }
    ],
    excluirSiContiene: [
      "expediente sancionador en materia de comercio",
      "sancion en materia de turismo"
    ]
  },
  "agricultura y ganaderia": {
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
      { texto: "acuicultura marina", puntos: 7 },
      { texto: "ayudas a la agricultura", puntos: 10 },
      { texto: "subvenciones pac", puntos: 10 },
      { texto: "sector pesquero y acuicultura", puntos: 9 }
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
  "licitaciones y obras": {
    threshold: 8,
    seccionesPreferidas: ["licitaciones publicas y adjudicaciones"],
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
      { texto: "expediente de contratacion", puntos: 6 },
      { texto: "suministros y servicios", puntos: 8 },
      { texto: "pliego de clausulas administrativas", puntos: 8 },
      { texto: "adjudicacion de contrato", puntos: 8 },
      { texto: "obras publicas de interes autonomico", puntos: 9 }
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
  "educacion y formacion": {
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
      { texto: "universidades publicas", puntos: 5 },
      { texto: "convocatoria de plazas de profesorado", puntos: 10 },
      { texto: "universidades publicas de andalucia", puntos: 9 }
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
  "sanidad y bienestar social": {
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
      { texto: "concurso de traslado", puntos: 6 },
      { texto: "servicio andaluz de salud", puntos: 10 },
      { texto: "personal estatutario", puntos: 9 },
      { texto: "prestaciones sociales publicas", puntos: 8 },
      { texto: "concurso de traslado sanidad", puntos: 9 }
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
  "subvenciones y ayudas generales": {
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
      { texto: "i+d+i empresarial", puntos: 7 },
      { texto: "incentivos economicos regionales", puntos: 10 },
      { texto: "ayudas a autonomos", puntos: 9 },
      { texto: "emprendimiento y creacion de empresas", puntos: 9 }
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
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(opciones.headers || {})
    }
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} - ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function ejecutar() {
  console.log("🚀 Iniciando capturador inteligente del BOJA...");

  const urlPortada = "https://www.juntadeandalucia.es/BOJA";
  let htmlPortada;
  try {
    const res = await fetch(urlPortada, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.log("⚠️ No se pudo acceder a la portada del BOJA.");
      return [];
    }
    htmlPortada = await res.text();
  } catch (error) {
    console.log(`⚠️ Error al conectar con la portada: ${error.message}`);
    return [];
  }

  const $ = cheerio.load(htmlPortada);
  let urlsPdfSumarios = [];

  $("a").each((_, el) => {
    const texto = $(el).text().toLowerCase();
    const href = $(el).attr("href");
    
    if (href && texto.includes("sumario boletín")) {
      let urlFinal = "";
      
      if (href.includes("/eboja/")) {
        urlFinal = new URL(href, "https://www.juntadeandalucia.es").href;
      } else {
        const cleanHref = href.startsWith("/") ? href : `/${href}`;
        const matchAnio = cleanHref.match(/BOJA(\d{2})-(\d+)-/);
        if (matchAnio) {
          const anioCompleto = `20${matchAnio[1]}`;
          const numBoletin = parseInt(matchAnio[2], 10);
          urlFinal = `https://www.juntadeandalucia.es/eboja/${anioCompleto}/${numBoletin}/${cleanHref.split('/').pop()}`;
        } else {
          urlFinal = new URL(cleanHref, "https://www.juntadeandalucia.es/eboja/").href;
        }
      }

      if (urlFinal && !urlsPdfSumarios.includes(urlFinal)) {
        urlsPdfSumarios.push(urlFinal);
      }
    }
  });

  console.log(`📄 PDFs de sumarios oficiales detectados:`, urlsPdfSumarios);

  if (urlsPdfSumarios.length === 0) {
    console.log("⚠️ No se ha podido extraer ningún PDF de sumario boletín.");
    return [];
  }

  const documentosProcesados = [];

  for (const urlPdfSumario of urlsPdfSumarios) {
    console.log(`📄 Descargando PDF del Sumario oficial: ${urlPdfSumario}`);

    let parsedPdf;
    try {
      const pdfRes = await fetch(urlPdfSumario, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
      if (!pdfRes.ok) {
        console.log(`⚠️ No se pudo descargar el archivo PDF (HTTP ${pdfRes.status}).`);
        continue;
      }
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      parsedPdf = await pdfParse(buffer);
    } catch (err) {
      console.log(`⚠️ Error al procesar el PDF del sumario: ${err.message}`);
      continue;
    }

    const textoCompleto = parsedPdf.text;
    const lineas = textoCompleto.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    console.log(`🔍 Analizando ${lineas.length} líneas de texto del sumario con el sistema de puntuación avanzado...`);

    let seccionActual = "";
    let tituloAcumulado = "";

    for (let i = 0; i < lineas.length; i++) {
      const linea = lineas[i];

      if (linea.length > 5 && linea.length < 100 && (linea === linea.toUpperCase() || linea.toLowerCase().includes("seccion"))) {
        seccionActual = linea;
      }

      if (linea.toLowerCase().includes("text núm") || linea.toLowerCase().includes("text num")) {
        if (tituloAcumulado.length > 15) {
          const sectorEncontrado = clasificarTexto(tituloAcumulado, seccionActual);

          if (sectorEncontrado) {
            documentosProcesados.push({
              titulo: tituloAcumulado,
              url_pdf: urlPdfSumario,
              sector: sectorEncontrado
            });
          }
        }
        tituloAcumulado = "";
      } else {
        tituloAcumulado += (tituloAcumulado ? " " : "") + linea;
      }
    }
  }

  const unicos = Array.from(new Map(documentosProcesados.map(d => [d.titulo, d])).values());
  console.log(`🎯 Anuncios relevantes encontrados: ${unicos.length}`);

  for (const d of unicos) {
    try {
      await supabaseRequest("anuncios_boja?on_conflict=url_pdf", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          titulo: d.titulo,
          url_pdf: d.url_pdf,
          categoria: d.sector
        })
      });
    } catch (err) {
      console.log(`⚠️ Aviso al guardar anuncio: ${err.message}`);
    }
  }

  console.log("👥 Consultando usuarios suscritos...");
  const usuarios = await supabaseRequest("perfiles_usuarios?select=email,sectores_suscritos&estado_suscripcion=eq.activa");

  for (const usuario of (usuarios || [])) {
    const relevantes = unicos.filter(doc => usuario.sectores_suscritos?.includes(doc.sector));
    if (relevantes.length === 0) continue;

    console.log(`📧 Enviando correo de alerta a ${usuario.email}...`);
    
    const htmlCorreo = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #006b4f;">Boletín Oficial de la Junta de Andalucía</h2>
        <p>Hola, <strong>tienes ${relevantes.length} alertas nuevas del BOJA de hoy</strong> relacionadas con tus sectores:</p>
        <ul style="line-height: 1.6;">
          ${relevantes.map(r => `
            <li style="margin-bottom: 12px;">
              <strong>[${r.sector.toUpperCase()}]</strong><br>
              <span style="font-size: 14px; color: #555;">${r.titulo}</span><br>
              <a href="${r.url_pdf}" target="_blank" style="color: #008f6a; font-weight: bold; text-decoration: underline;">Ver documento PDF oficial en el BOJA</a>
            </li>
          `).join("")}
        </ul>
        <p style="font-size: 12px; color: #888; margin-top: 20px;">Mensaje automático de tu plataforma de empleo y formación.</p>
      </div>
    `;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { 
        Authorization: `Bearer ${RESEND_API_KEY}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({
        from: "BoletínHoy <alertas@boletinhoy.es>",
        to: [usuario.email],
        subject: `🔔 Tienes ${relevantes.length} alertas nuevas del BOJA de hoy`,
        html: htmlCorreo
      })
    });
  }

  console.log("✅ Proceso completado con éxito.");
  return unicos;
}

export { ejecutar as ejecutarBOJA };
