import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY;
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
    console.log("🚀 [BOJA] Capturando disposiciones mediante API JSON oficial (ventana deslizante reciente)...");

    const documentosProcesados = [];
    const anioActual = new Date().getFullYear();
    const urlJson = `https://datos.juntadeandalucia.es/api/v0/boja/all?year=${anioActual}&format=json`;

    let totalPdfsEncontrados = 0;
    let relevantesEnJson = 0;

    try {
        const respuesta = await fetchWithRetry(urlJson, {
            headers: { "User-Agent": USER_AGENT }
        });

        const data = await respuesta.json();
        if (!Array.isArray(data)) {
            throw new Error("El formato de la respuesta JSON no es un array válido.");
        }

        // Ordenar de más reciente a más antigua por fecha UTC y número de disposición descendente
        data.sort((a, b) => {
            const dateA = new Date(a.dateUTC || 0);
            const dateB = new Date(b.dateUTC || 0);
            if (dateB - dateA !== 0) return dateB - dateA;
            return (b.number || 0) - (a.number || 0);
        });

        // Tomar los últimos 150 registros para asegurar que capturamos todo lo reciente, ordinarios y extraordinarios
        const registrosRecientes = data.slice(0, 150);

        console.log(`📊 Registros recientes analizados del JSON: ${registrosRecientes.length}`);

        for (const item of registrosRecientes) {
            if (!item.hasPdf || !item.pdf || !item.pdf[0] || !item.pdf[0].publicUrl) continue;

            totalPdfsEncontrados++;
            const urlPdfFinal = item.pdf[0].publicUrl;
            const titulo = item.summaryNoHtml || item.title || "";
            const organizacion = item.organisation || "";

            if (titulo.length > 10) {
                const sectorEncontrado = clasificarTexto(titulo, organizacion);
                if (sectorEncontrado) {
                    relevantesEnJson++;
                    documentosProcesados.push({
                        titulo: titulo,
                        url_pdf: urlPdfFinal,
                        sector: sectorEncontrado
                    });
                }
            }
        }

        console.log(`📄 Analizados ${totalPdfsEncontrados} PDFs | ${relevantesEnJson} relevantes encontrados`);

    } catch (error) {
        console.log(`↪️ Error procesando la API JSON del BOJA: ${error.message}`);
    }

    const unicos = Array.from(
        new Map(documentosProcesados.map(d => [d.url_pdf, d])).values()
    );

    console.log("======================================");
    console.log(`🎯 TOTAL DISPOSICIONES RECIENTES ANALIZADAS: ${totalPdfsEncontrados}`);
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
