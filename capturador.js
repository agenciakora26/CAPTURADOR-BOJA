import * as cheerio from "cheerio";
import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SECTORES = {
  "Oposiciones y Empleo": {
    threshold: 3,
    fuertes: [
      { texto: "oposicion", points: 5 },
      { texto: "concurso-oposicion", points: 5 },
      { texto: "bolsa de trabajo", points: 5 },
      { texto: "bolsa de empleo", points: 5 },
      { texto: "oferta de empleo publico", points: 5 },
      { texto: "proceso selectivo", points: 4 },
      { texto: "pruebas selectivas", points: 4 },
      { texto: "personal funcionario", points: 4 },
      { texto: "personal laboral", points: 4 },
      { texto: "convocatoria", points: 3 },
      { texto: "plazas", points: 3 }
    ],
    medias: [
      { texto: "plaza", points: 2 },
      { texto: "empleo", points: 2 },
      { texto: "seleccion", points: 2 },
      { texto: "aspirantes", points: 2 },
      { texto: "turno libre", points: 3 },
      { texto: "promocion interna", points: 2 }
    ],
    negativas: [
      { texto: "cese", points: -3 },
      { texto: "jubilacion", points: -3 }
    ],
    excluirSiContiene: []
  },
  "Subvenciones y Ayudas": {
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
      { texto: "fomento", points: 2 }
    ],
    negativas: [],
    excluirSiContiene: []
  },
  "Licitaciones y Contratación": {
    threshold: 3,
    fuertes: [
      { texto: "licitacion", points: 5 },
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
  "Agricultura y Ganadería": {
    threshold: 3,
    fuertes: [
      { texto: "agricultura", points: 4 },
      { texto: "ganaderia", points: 4 },
      { texto: "pesca", points: 4 },
      { texto: "explotaciones agrarias", points: 5 },
      { texto: "pac", points: 4 },
      { texto: "produccion ecologica", points: 4 },
      { texto: "ayudas", points: 2 }
    ],
    medias: [
      { texto: "agrario", points: 2 },
      { texto: "rural", points: 2 }
    ],
    negativas: [],
    excluirSiContiene: []
  },
  "Urbanismo y Medio Ambiente": {
    threshold: 3,
    fuertes: [
      { texto: "urbanismo", points: 4 },
      { texto: "medio ambiente", points: 4 },
      { texto: "plan general", points: 4 },
      { texto: "sostenibilidad", points: 4 },
      { texto: "energia", points: 3 }
    ],
    medias: [
      { texto: "territorio", points: 2 },
      { texto: "ambiental", points: 2 }
    ],
    negativas: [],
    excluirSiContiene: []
  },
  "Sanidad y Asuntos Sociales": {
    threshold: 3,
    fuertes: [
      { texto: "sanidad", points: 4 },
      { texto: "servicio andaluz de salud", points: 5 },
      { texto: "dependencia", points: 4 },
      { texto: "servicios sociales", points: 4 },
      { texto: "discapacidad", points: 4 }
    ],
    medias: [
      { texto: "salud", points: 2 },
      { texto: "social", points: 2 }
    ],
    negativas: [],
    excluirSiContiene: []
  },
  "Educación y Universidades": {
    threshold: 3,
    fuertes: [
      { texto: "educacion", points: 4 },
      { texto: "formacion profesional", points: 5 },
      { texto: "becas", points: 5 },
      { texto: "centros docentes", points: 4 },
      { texto: "universidad", points: 4 }
    ],
    medias: [
      { texto: "ensenanza", points: 2 },
      { texto: "curso", points: 2 }
    ],
    negativas: [],
    excluirSiContiene: []
  }
};

function clasificarTexto(texto, seccion) {
  const textoAnalizar = (seccion + " " + texto).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let mejorSector = null;
  let maxPuntuacion = 0;

  for (const [sector, reglas] of Object.entries(SECTORES)) {
    let puntuacion = 0;
    
    for (const fuerte of (reglas.fuertes || [])) {
      const valor = fuerte.points !== undefined ? fuerte.points : (fuerte.puntos || 3);
      if (textoAnalizar.includes(fuerte.texto.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
        puntuacion += valor;
      }
    }
    
    for (const media of (reglas.medias || [])) {
      const valor = media.points !== undefined ? media.points : (media.puntos || 2);
      if (textoAnalizar.includes(media.texto.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
        puntuacion += valor;
      }
    }

    if (puntuacion >= reglas.threshold && puntuacion > maxPuntuacion) {
      maxPuntuacion = puntuacion;
      mejorSector = sector;
    }
  }
  return mejorSector;
}

async function fetchWithRetry(url, opciones = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, opciones);
            if (res.ok) return res;
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
    throw new Error(`Failed after ${retries} retries`);
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

async function ejecutarCapturadorBoja() {
    console.log("🚀 [BOJA] Capturando mediante lectura directa de canales de distribución...");

    const documentosProcesados = [];
    const urlBase = "https://www.juntadeandalucia.es";
    const xmlFiles = ["s51.xml", "s52.xml", "s53.xml", "s54.xml", "s55.xml", "s56.xml", "s57.xml"];

    let totalPdfsEncontrados = 0;

    for (const xmlFile of xmlFiles) {
        const urlRss = `${urlBase}/boja/distribucion/${xmlFile}`;
        let pdfsEnXml = 0;
        let relevantesEnXml = 0;

        try {
            const respuesta = await fetchWithRetry(urlRss, {
                headers: { "User-Agent": USER_AGENT },
                signal: AbortSignal.timeout(15000)
            });

            const html = await respuesta.text();
            const $ = cheerio.load(html);

            $("a").each((_, el) => {
                const textoEnlace = $(el).text().trim();
                const href = $(el).attr("href");

                if (href && (textoEnlace.includes("Descargar la disposición en PDF") || href.includes("/boja/2026/"))) {
                    if (!href.includes("/boja/2026/")) return;

                    pdfsEnXml++;
                    totalPdfsEncontrados++;

                    const urlPdfFinal = href.startsWith("http") ? href : new URL(href, urlBase).href;
                    const textoBloque = $(el).parent().text() || $(el).closest("div, p, body").text();

                    let nextNodesText = [];
                    let next = el.nextSibling;
                    while (next) {
                        if (next.type === 'tag' && next.name === 'a' && $(next).text().includes("Descargar la disposición en PDF")) {
                            break;
                        }
                        const txt = next.type === 'text' ? next.data : $(next).text();
                        if (txt) nextNodesText.push(txt);
                        next = next.nextSibling;
                    }

                    let textoDespues = nextNodesText.join(" ").replace(/\s+/g, " ").trim();
                    let textoCompleto = textoBloque + " " + textoDespues;

                    let tituloLimpio = "";

                    // 1. Manejo específico para el primer anuncio del XML que viene pegado a "Junta de Andalucía"
                    if (/Junta de Andalucía/i.test(textoCompleto)) {
                        const partes = textoCompleto.split(/Junta de Andalucía/i);
                        if (partes.length > 1 && partes[1].trim().length > 10) {
                            tituloLimpio = partes[1].trim();
                        }
                    }

                    // 2. Si no viene del primer anuncio o falló, buscar directamente la palabra clave oficial de inicio (Resolución, Orden, etc.)
                    if (!tituloLimpio || tituloLimpio.length < 15 || tituloLimpio.toLowerCase().includes("boletín:")) {
                        const matchKeyword = textoCompleto.match(/(Resolución|Orden|Decreto|Extracto|Acuerdo|Edicto|Anuncio|Convenio|Corrección)\b/i);
                        if (matchKeyword && matchKeyword.index !== undefined) {
                            tituloLimpio = textoCompleto.substring(matchKeyword.index).trim();
                        } else if (textoDespues.length > 15) {
                            tituloLimpio = textoDespues;
                        } else {
                            tituloLimpio = textoBloque;
                        }
                    }

                    // 3. Limpieza rigurosa para eliminar URLs residuales, fechas y esquemas de boletín
                    tituloLimpio = tituloLimpio
                        .replace(/https?:\/\/[^\s]+/g, "")
                        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, "")
                        .replace(/Boletín:\s*BOJA[^\s]+/gi, "")
                        .replace(/Organismo:\s*.*?(?=Administración:|Sección:|$)/gi, "")
                        .replace(/Administración:\s*.*?(?=Sección:|$)/gi, "")
                        .replace(/Sección:\s*[\d\.\s-\w,]+/gi, "")
                        .replace(/Descargar la disposición en PDF/gi, "")
                        .replace(/\s+/g, " ")
                        .trim();

                    if (tituloLimpio.length > 15) {
                        const sectorEncontrado = clasificarTexto(textoCompleto, "");
                        if (sectorEncontrado) {
                            relevantesEnXml++;
                            documentosProcesados.push({
                                titulo: tituloLimpio,
                                url_pdf: urlPdfFinal,
                                sector: sectorEncontrado
                            });
                        }
                    }
                }
            });

            console.log(`📄 ${xmlFile} ──> ${pdfsEnXml} PDFs encontrados | ${relevantesEnXml} relevantes`);

        } catch (error) {
            console.log(`↪️ Error procesando ${xmlFile}: ${error.message}`);
        }
    }

    const unicos = Array.from(
        new Map(documentosProcesados.map(d => [d.url_pdf, d])).values()
    );

    console.log("======================================");
    console.log(`🎯 TOTAL PDFs ANALIZADOS: ${totalPdfsEncontrados}`);
    console.log(`📢 ANUNCIOS RELEVANTES ENCONTRADOS EN BOJA: ${unicos.length}`);
    console.log("======================================");

    for (const d of unicos) {
        try {
            const existentes = await supabaseRequest(`anuncios_boja?url_pdf=eq.${encodeURIComponent(d.url_pdf)}`, {
                method: "GET"
            });

            if (existentes && existentes.length > 0) continue;

            await supabaseRequest(
                "anuncios_boja",
                {
                    method: "POST",
                    body: JSON.stringify({
                        titulo: d.titulo,
                        url_pdf: d.url_pdf,
                        categoria: d.sector,
                        origen: "BOJA",
                        enviado: false
                    })
                }
            );

            console.log(`✅ Guardado en Supabase (BOJA): ${d.titulo.substring(0, 40)}...`);

        } catch (err) {
            console.log(`⚠️ Aviso al guardar en Supabase (BOJA): ${err.message}`);
        }
    }

    return unicos;
}

export { ejecutarCapturadorBoja as ejecutarBOJA };
