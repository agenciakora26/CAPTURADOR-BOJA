const cheerio = require("cheerio");
const pdfParse = require("pdf-parse");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const BASE_BOJA = "https://www.juntadeandalucia.es/eboja";
const USER_AGENT = "Mozilla/5.0 (compatible; BoletinHoy/1.0)";

// Sectores y palabras clave esenciales
const SECTORES = {
  "oposiciones y empleo público": ["oposicion", "empleo publico", "bolsa de empleo", "personal funcionario", "plaza"],
  "subvenciones y ayudas": ["subvencion", "bases reguladoras", "ayudas", "incentivo", "plazo de solicitud"],
  "sanidad y servicios sociales": ["servicio andaluz de salud", "sanidad", "hospital", "enfermeria", "dependencia"]
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

async function ejecutar() {
  console.log("🚀 Iniciando capturador simplificado del BOJA...");

  // 1. Obtener fecha actual en formato YYYYMMDD
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = String(hoy.getMonth() + 1).padStart(2, "0");
  const dia = String(hoy.getDate()).padStart(2, "0");
  const formatoFecha = `${anio}${mes}${dia}`;
  const urlIndice = `${BASE_BOJA}/${formatoFecha}.html`;

  console.log(`📅 Consultando índice del BOJA: ${urlIndice}`);
  
  let html;
  try {
    const respuesta = await fetch(urlIndice, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000)
    });

    if (!respuesta.ok) {
      console.log(`⚠️ No hay BOJA disponible para hoy (HTTP ${respuesta.status}). Puede ser fin de semana o festivo.`);
      return;
    }
    html = await respuesta.text();
  } catch (error) {
    console.log(`⚠️ Error al conectar con la web del BOJA: ${error.message}`);
    return;
  }

  const $ = cheerio.load(html);
  const documentosEncontrados = [];

  // 2. Extraer enlaces a disposiciones y PDFs del día
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const urlAbsoluta = new URL(href, urlIndice).href;
    const texto = $(el).text().trim();

    if (urlAbsoluta.toLowerCase().includes(".pdf") || urlAbsoluta.includes("/eboja/")) {
      documentosEncontrados.push({
        urlPdf: urlAbsoluta.endsWith(".pdf") ? urlAbsoluta : null,
        urlDisposicion: urlAbsoluta,
        titulo: texto || "Documento oficial BOJA"
      });
    }
  });

  const unicos = Array.from(new Map(documentosEncontrados.map(d => [d.urlDisposicion, d])).values());
  console.log(`📄 Se han encontrado ${unicos.length} enlaces en el BOJA de hoy.`);

  // 3. Procesar PDFs, extraer texto y clasificar por palabras clave
  const documentosProcesados = [];
  for (const doc of unicos) {
    if (!doc.urlPdf) continue; // Nos centramos en los que apuntan directamente a PDF o extracto
    try {
      const pdfRes = await fetch(doc.urlPdf, { 
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10000) 
      });
      if (!pdfRes.ok) continue;

      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      const parsed = await pdfParse(buffer);
      const textoNorm = normalizar(parsed.text);

      const sectoresCoincidentes = [];
      for (const [sector, palabras] of Object.entries(SECTORES)) {
        const encontrada = palabras.some(palabra => textoNorm.includes(normalizar(palabra)));
        if (encontrada) sectoresCoincidentes.push(sector);
      }

      documentosProcesados.push({
        titulo: doc.titulo,
        url_pdf: doc.urlPdf,
        categoria: sectoresCoincidentes.length > 0 ? sectoresCoincidentes.join(", ") : "General",
        sectores: sectoresCoincidentes
      });
    } catch (err) {
      // Ignoramos errores individuales de PDFs que fallen al descargar/parsear
    }
  }

  console.log(`🔍 PDFs analizados con éxito: ${documentosProcesados.length}`);

  // 4. Guardar en Supabase (evitando duplicados por url_pdf)
  if (documentosProcesados.length > 0) {
    console.log("💾 Guardando registros en Supabase...");
    await supabaseRequest("anuncios_boja?on_conflict=url_pdf", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(documentosProcesados.map(d => ({
        titulo: d.titulo,
        url_pdf: d.url_pdf,
        categoria: d.categoria
      })))
    });
  }

  // 5. Consultar usuarios y enviar correos mediante Resend
  console.log("👥 Consultando usuarios suscritos...");
  const usuarios = await supabaseRequest("perfiles_usuarios?select=email,sectores_suscritos&estado_suscripcion=eq.activa");

  for (const usuario of (usuarios || [])) {
    const relevantes = documentosProcesados.filter(doc => 
      doc.sectores.some(s => usuario.sectores_suscritos?.includes(s))
    );

    if (relevantes.length === 0) continue;

    console.log(`📧 Enviando correo de alerta a ${usuario.email}...`);
    const htmlCorreo = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #006b4f;">Nuevas publicaciones del BOJA</h2>
        <p>Hola, hemos detectado ${relevantes.length} nuevas publicaciones de tu interés en el BOJA de hoy:</p>
        <ul>
          ${relevantes.map(r => `<li style="margin-bottom: 10px;"><a href="${r.url_pdf}" target="_blank" style="color: #008f6a; font-weight: bold;">${r.titulo}</a><br><small style="color: #666;">Categoría: ${r.categoria}</small></li>`).join("")}
        </ul>
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
        subject: "🔔 Alertas BOJA de hoy",
        html: htmlCorreo
      })
    });
  }

  console.log("✅ Proceso finalizado correctamente.");
}

ejecutar().catch((error) => {
  console.error("❌ Error crítico en el script:", error);
  process.exit(1);
});
