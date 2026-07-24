import os
import feedparser
from supabase import create_client, Client

# Conexión automática con Supabase usando las claves secretas que guardaste
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
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
