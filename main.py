import os
import feedparser
from supabase import create_client, Client

# Obtenemos la URL y la limpiamos automáticamente si tiene '/rest/v1/' al final
raw_url = os.environ.get("SUPABASE_URL", "")
url = raw_url.replace("/rest/v1", "").rstrip("/")
key: str = os.environ.get("SUPABASE_KEY", "")

# Conexión con Supabase
supabase: Client = create_client(url, key)

# Dirección del canal oficial RSS del BOJA
url_boja = "https://www.juntadeandalucia.es/boja/distribucion/s51.xml"

# Lectura del boletín de hoy
feed = feedparser.parse(url_boja)

# Guardar cada anuncio en Supabase
for entry in feed.entries:
    titulo = entry.get('title', 'Sin título')
    link = entry.get('link', '')
    
    data = {
        "titulo": titulo,
        "url_pdf": link
    }
    supabase.table("anuncios_boja").insert(data).execute()

print("¡Lectura y guardado del BOJA completados!")
