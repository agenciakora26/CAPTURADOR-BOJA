import * as cheerio from "cheerio";
import pdfParse from "pdf-parse";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0)";

const SECTORES = {
  "oposiciones y empleo": {
    threshold: 4,
    fuertes: [
      { texto: "oposicion", puntos: 5 },
      { texto: "concurso-oposicion", puntos: 5 },
      { texto: "bolsa de trabajo", puntos: 5 },
      { texto: "bolsa de empleo", puntos: 5 },
      { texto: "oferta de empleo publico", puntos: 5 },
      { texto: "proceso selectivo", puntos: 4 },
      { texto: "pruebas selectivas", puntos: 4 },
      { texto: "personal funcionario", puntos: 4 },
      { texto: "personal laboral", points: 4 },
      { texto: "convocatoria", puntos: 3 }
    ],
    medias: [
      { texto: "plaza", puntos: 2 },
      { texto: "empleo", puntos: 2 },
      { texto: "seleccion", puntos: 2 },
      { texto: "aspirantes", points: 2 },
      { texto: "turno libre", puntos: 3 },
      { texto: "promocion interna", points: 2 },
      { texto: "personal", points: 1 }
    ],
    negativas: [
      { texto: "cese", puntos: -3 },
      { texto: "jubilacion", puntos: -3 }
    ],
    excluirSiContiene: []
  },
  "hosteleria y comercio": {
    threshold: 3,
    fuertes: [
      { texto: "hosteleria", puntos: 5 },
      { texto: "comercio", puntos: 4 },
      { texto: "turismo", puntos: 4 },
      { texto: "restauracion", puntos: 4 },
      { texto: "establecimientos comerciales", puntos: 5 },
      { texto: "artesania", puntos: 4 }
    ],
    medias: [
      { texto: "hotel", points: 2 },
      { texto: "bono turistico", points: 4 },
      { texto: "ayudas", points: 2 },
      { texto: "subvencion", points: 2 },
      { texto: "mercado", points: 2 }
    ],
    negativas: [],
    excluirSiContiene: []
  },
  "agricultura y ganaderia": {
    threshold: 3,
    fuertes: [
      { texto: "agricultura", puntos: 4 },
      { texto: "ganaderia", puntos: 4 },
      { texto: "pesca", points: 4 },
      { texto: "explotaciones agrarias", points: 5 },
      { texto: "pac", points: 4 },
      { texto: "produccion ecologica", points: 4 },
      { texto: "ayudas", points: 2 }
    ],
    medias: [
      { texto: "agrario", points: 2 },
      { texto: "rural", points: 2 },
      { texto: "olivar", points: 3 },
      { texto: "vinedo", points: 3 },
      { texto: "subvencion", points: 2 }
    ],
    negativas: [],
    excluirSiContiene: []
  },
  "licitaciones y obras": {
    threshold: 4,
    fuertes: [
      { texto: "licitacion", puntos: 5 },
      { texto: "contratacion", points: 4 },
      { texto: "contrato de obras", points: 5 },
      { texto: "contrato de servicios", points: 4 },
      { texto: "suministros", points: 4 },
      { texto: "adjudicacion", points: 3 },
      { texto: "pliego", points: 3 }
    ],
    medias: [
      { texto: "obras", points: 2 },
      { texto: "servicio", points: 1 },
      { texto: "procedimiento abierto", points: 3 }
    ],
    negativas: [],
    excluirSiContiene: []
  },
  "educacion y formacion": {
    threshold: 3,
    fuertes: [
      { texto: "educacion", points: 4 },
      { texto: "formacion profesional", points: 5 },
      { texto: "becas", points: 5 },
      { texto: "centros docentes", points: 4 },
      { texto: "universidad", points: 4 },
      { texto: "profesorado", points: 4 },
      { texto: "alumnado", points: 3 }
    ],
    medias: [
      { texto: "ensenanza", points: 2 },
      { texto: "curso", points: 2 },
      { texto: "ayudas", points: 2 },
      { texto: "subvenciones", points: 2 }
    ],
    negativas: [],
    excluirSiContiene: []
  },
  "sanidad y bienestar social": {
    threshold: 3,
    fuertes: [
      { texto: "sanidad", points: 4 },
      { texto: "servicio andaluz de salud", points: 5 },
      { texto: "dependencia", points: 4 },
      { texto: "servicios sociales", points: 4 },
      { texto: "discapacidad", points: 4 },
      { texto: "prestaciones", points: 3 }
    ],
    medias: [
      { texto: "salud", points: 2 },
      { texto: "social", points: 2 },
      { texto: "atencion primaria", points: 3 },
      { texto: "ayudas", points: 2 }
    ],
    negativas: [],
    excluirSiContiene: []
  },
  "subvenciones y ayudas generales": {
    threshold: 3,
    fuertes: [
      { texto: "subvencion", points: 4 },
      { texto: "subvenciones", points: 4 },
      { texto: "ayudas", points: 4 },
      { texto: "concesion", points: 3 },
      { texto: "bases reguladoras", points: 4 },
      { texto: "incentivos", points: 3 },
      { texto: "autonomos", points: 4 }
    ],
    medias: [
      { texto: "beneficiarios", points: 2 },
      { texto: "solicitudes", points: 2 },
      { texto: "fomento", points: 2 },
      { texto: "emprendimiento", points: 3 }
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

    console.log(`🔍 Analizando ${lineas.length} líneas de texto del sumario con el sistema flexible...`);

    let seccionActual = "";

    for (let i = 0; i < lineas.length; i++) {
      const linea = lineas[i];

      // Detección de posibles cabeceras de sección
      if (linea.length > 5 && linea.length < 100 && (linea === linea.toUpperCase() || linea.toLowerCase().includes("consejería") || linea.toLowerCase().includes("seccion"))) {
        seccionActual = linea;
        continue;
      }

      // Evaluamos directamente cada línea o titular significativo que tenga una longitud mínima
      if (linea.length > 20) {
        const sectorEncontrado = clasificarTexto(linea, seccionActual);

        if (sectorEncontrado) {
          documentosProcesados.push({
            titulo: linea,
            url_pdf: urlPdfSumario,
            sector: sectorEncontrado
          });
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

  // ... (todo tu código anterior) ...

  console.log("✅ Proceso completado con éxito.");
  return unicos;
}

export { ejecutar as ejecutarBOJA };
