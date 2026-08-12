import * as cheerio from "cheerio";
import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SECTORES = {
  "Oposiciones y Empleo": {
    threshold: 3,
    fuertes: [
      { texto: "oposicion", puntos: 5 },
      { texto: "concurso-oposicion", puntos: 5 },
      { texto: "bolsa de trabajo", puntos: 5 },
      { texto: "bolsa de empleo", puntos: 5 },
      { texto: "oferta de empleo publico", puntos: 5 },
      { texto: "proceso selectivo", puntos: 4 },
      { texto: "pruebas selectivas", puntos: 4 },
      { texto: "personal funcionario", puntos: 4 },
      { texto: "personal laboral", puntos: 4 },
      { texto: "convocatoria", puntos: 3 },
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
      if (textoAnalizar.includes(fuerte.texto.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
        puntuacion += fuerte.puntos;
      }
    }
    for (const media of (reglas.medias || [])) {
      if (textoAnalizar.includes(media.texto.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
        puntuacion += media.points;
      }
    }
    if (puntuacion >= reglas.threshold && puntuacion > maxPuntuacion) {
      maxPuntuacion = puntuacion;
      mejorSector = sector;
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

async function ejecutarCapturadorBoja() {
    console.log("🚀 [BOJA] Capturando mediante lectura directa de canales de distribución...");

    const documentosProcesados = [];
    const urlBase = "https://www.juntadeandalucia.es";

    const xmlFiles = [
        "s51.xml", "s52.xml", "s53.xml", "s54.xml", "s55.xml", "s56.xml", "s57.xml"
    ];

    for (const xmlFile of xmlFiles) {
        const urlRss = `${urlBase}/boja/distribucion/${xmlFile}`;
        try {
            const respuesta = await fetch(urlRss, {
                headers: { "User-Agent": USER_AGENT },
                signal: AbortSignal.timeout(15000)
            });

            if (!respuesta.ok) continue;

            const html = await respuesta.text();
            const $ = cheerio.load(html);

            // Buscamos los enlaces de "Descargar la disposición en PDF"
            $("a").each((_, el) => {
                const textoEnlace = $(el).text().trim();
                const href = $(el).attr("href");

                if (href && textoEnlace.includes("Descargar la disposición en PDF")) {
                    const urlPdfFinal = href.startsWith("http") ? href : new URL(href, urlBase).href;

                    const $padre = $(el).parent();
                    const $clon = $padre.clone();
                    $clon.find("a, script").remove();

                    let textoBruto = $clon.text()
                        .replace("Descargar la disposición en PDF", "")
                        .replace(/http:\/\/.*$/, "")
                        .replace(/\s+/g, " ")
                        .trim();

                    if (textoBruto.length > 20) {
                        // Extraer limpiamente las partes mediante patrones de texto
                        const matchOrg = textoBruto.match(/Organismo:\s*(.*?)(?=Administración:|Sección:|$)/i);
                        const matchSec = textoBruto.match(/Sección:\s*(.*)/i);
                        const matchBoletin = textoBruto.match(/(Boletín:\s*BOJA[^O]+)/i);

                        const boletinLim = matchBoletin ? matchBoletin[1].trim() : "BOJA";
                        const organismoLim = matchOrg ? matchOrg[1].trim() : "";
                        const seccionLim = matchSec ? matchSec[1].trim() : "";

                        // Construir un título ordenado y legible
                        let tituloLimpio = textoBruto;
                        if (organismoLim && seccionLim) {
                            tituloLimpio = `${organismoLim} — ${seccionLim}`;
                        } else if (organismoLim) {
                            tituloLimpio = `${organismoLim} (${boletinLim})`;
                        }

                        const sectorEncontrado = clasificarTexto(textoBruto, "");
                        if (sectorEncontrado) {
                            documentosProcesados.push({
                                titulo: tituloLimpio,
                                url_pdf: urlPdfFinal,
                                sector: sectorEncontrado
                            });
                        }
                    }
                }
            });

        } catch (error) {
            console.log(`↪️ Error procesando ${xmlFile}: ${error.message}`);
        }
    }

    const unicos = Array.from(
        new Map(documentosProcesados.map(d => [d.url_pdf, d])).values()
    );

    console.log("======================================");
    console.log(`🎯 ANUNCIOS RELEVANTES ENCONTRADOS EN BOJA: ${unicos.length}`);
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
