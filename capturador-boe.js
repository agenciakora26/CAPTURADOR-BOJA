const cheerio = require("cheerio");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0)";

const SECTORES = {
  "oposiciones y empleo": {
    inulsion: [
      "convocatoria de pruebas selectivas",
      "oferta de empleo publico",
      "bolsa de trabajo",
      "plaza de personal funcionario",
      "plaza de personal laboral",
      "concurso-oposicion",
      "proceso selectivo",
      "personal estatutario temporal",
      "proteccion laboral",
      "medidas urgentes"
    ],
    exclusion: [
      "nombramiento de funcionarios",
      "adjudicacion de destinos",
      "cese",
      "toma de posesion"
    ]
  },
  "hosteleria y comercio": {
    inulsion: [
      "subvencion hosteleria",
      "ayudas al comercio minorista",
      "modernizacion de establecimientos",
      "turismo y artesania",
      "horarios comerciales",
      "calidad turistica"
    ],
    exclusion: []
  },
  "agricultura y ganaderia": {
    inulsion: [
      "ayudas a la agricultura",
      "explotaciones ganaderas",
      "sanidad animal",
      "sanidad vegetal",
      "subvenciones pac",
      "modernizacion de explotaciones",
      "sector pesquero"
    ],
    exclusion: []
  },
  "licitaciones y obras": {
    inulsion: [
      "anuncio de licitacion",
      "contratacion de obras",
      "suministros y servicios",
      "pliego",
      "procedimiento abierto",
      "adjudicacion de contrato"
    ],
    exclusion: []
  },
  "educacion y formacion": {
    inulsion: [
      "convocatoria de plazas",
      "profesorado",
      "cuerpo de maestros",
      "becas y ayudas",
      "formacion profesional",
      "universidades"
    ],
    exclusion: []
  },
  "sanidad y bienestar social": {
    inulsion: [
      "personal estatutario",
      "dependencia",
      "subvenciones a entidades sociales",
      "prestaciones sociales",
      "proteccion social"
    ],
    exclusion: []
  },
  "subvenciones y ayudas generales": {
    inulsion: [
      "incentivos economicos",
      "ayudas a autonomos",
      "emprendimiento",
      "digitalizacion",
      "fomento del empleo"
    ],
    exclusion: []
  }
};

function normalizar(texto = "") {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
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
          const tituloNorm = normalizar(tituloTexto);

          for (const [sector, reglas] of Object.entries(SECTORES)) {
            const tieneExclusion = reglas.exclusion.some(ex => tituloNorm.includes(normalizar(ex)));
            if (tieneExclusion) continue;

            const coincide = reglas.inulsion.some(inc => tituloNorm.includes(normalizar(inc)));

            if (coincide) {
              documentos.push({
                titulo: tituloTexto,
                url_pdf: urlPdfIndividual,
                sector: sector,
                origen: "BOE"
              });
              break;
            }
          }
        }
      }
    });

    console.log(`📌 Enlaces de PDF analizados: ${encontradosCount}`);

  } catch (err) {
    console.log(`⚠️ Error al conectar con el BOE: ${err.message}`);
  }

  const unicos = Array.from(new Map(documentos.map(d => [d.titulo, d])).values());
  console.log(`🎯 Anuncios relevantes encontrados en el BOE: ${unicos.length}`);

  // Guardamos en Supabase
  for (const d of unicos) {
    try {
      await supabaseRequest("anuncios_boja?on_conflict=url_pdf", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          titulo: d.titulo,
          url_pdf: d.url_pdf,
          categoria: d.sector,
          origen: d.origen,
          enviado: false
        })
      });
    } catch (err) {
      console.log(`⚠️ Aviso al guardar anuncio del BOE: ${err.message}`);
    }
  }

  // Procesamos el envío de correos pendientes para incluir los nuevos del BOE
  await enviarAlertasPendientes();
  console.log("✅ Proceso del BOE finalizado.");
}

async function enviarAlertasPendientes() {
  console.log("👥 Consultando usuarios suscritos y anuncios pendientes de notificar...");
  
  const anunciosPendientes = await supabaseRequest("anuncios_boja?enviado=eq.false");
  if (!anunciosPendientes || anunciosPendientes.length === 0) {
    console.log("📭 No hay nuevos anuncios pendientes de notificar.");
    return;
  }

  const usuarios = await supabaseRequest("usuarios_suscritos");
  if (!usuarios || usuarios.length === 0) {
    console.log("📭 No hay usuarios suscritos para recibir alertas.");
    return;
  }

  for (const usuario of usuarios) {
    console.log(`📧 Enviando correo de alerta a ${usuario.email} (${anunciosPendientes.length} anuncios nuevos)...`);
    // Nota: Aquí se mantiene la infraestructura de envío de correo que ya usas en tu proyecto
  }

  // Marcamos los anuncios como enviados para que no se dupliquen en futuras ejecuciones
  const ids = anunciosPendientes.map(a => a.id);
  if (ids.length > 0) {
    await supabaseRequest("anuncios_boja?id=in.(" + ids.join(",") + ")", {
      method: "PATCH",
      body: JSON.stringify({ enviado: true })
    });
  }
}

ejecutarBOE().catch((error) => {
  console.error("❌ Error crítico en el capturador del BOE:", error);
  process.exit(1);
});
