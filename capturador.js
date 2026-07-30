const urlPortada = "https://www.juntadeandalucia.es/BOJA";
  let htmlPortada;
  try {
    const res = await fetch(urlPortada, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.log("⚠️ No se pudo acceder a la portada del BOJA.");
      return;
    }
    htmlPortada = await res.text();
  } catch (error) {
    console.log(`⚠️ Error al conectar con la portada: ${error.message}`);
    return;
  }

  const $ = cheerio.load(htmlPortada);
  let urlsSumarios = [];

  // Recorremos todos los enlaces buscando específicamente los sumarios del día
  $("a").each((_, el) => {
    const texto = $(el).text().toLowerCase();
    const href = $(el).attr("href");
    
    if (href) {
      const urlAbsoluta = new URL(href, "https://www.juntadeandalucia.es").href;
      // Filtramos para asegurarnos de que es un PDF de sumario y no una disposición individual larga
      if (urlAbsoluta.toLowerCase().endsWith(".pdf") && (texto.includes("sumario") || urlAbsoluta.includes("sumario") || urlAbsoluta.includes("sumnario"))) {
        if (!urlsSumarios.includes(urlAbsoluta)) {
          urlsSumarios.push(urlAbsoluta);
        }
      }
    }
  });

  console.log(`📋 Sumarios detectados hoy:`, urlsSumarios);

  if (urlsSumarios.length === 0) {
    console.log("⚠️ No se han encontrado enlaces de sumarios en la portada.");
    return;
  }
