import os
import feedparser
from supabase import create_client, Client

# Conexión con Supabase
raw_url = os.environ.get("SUPABASE_URL", "")
url = raw_url.replace("/rest/v1", "").rstrip("/")
key: str = os.environ.get("SUPABASE_KEY", "")
supabase: Client = create_client(url, key)

# Función para categorizar el anuncio según palabras clave en el título
def obtener_categoria(titulo):
    texto = titulo.lower()
    
    if any(palabra in texto for palabra in ["oposicion", "oposiciones", "nombramiento", "personal", "bolsa de trabajo", "plaza", "pruebas selectivas"]):
        return "Oposiciones y Empleo"
    elif any(palabra in texto for palabra in ["subvencion", "subvenciones", "ayuda", "incentivo", "beca", "financiacion"]):
        return "Subvenciones y Ayudas"
    elif any(palabra in texto for palabra in ["licitacion", "contratacion", "adjudicacion", "contrato", "pliego"]):
        return "Contratación Pública"
    elif any(palabra in texto for palabra in ["medio ambiente", "forestal", "agua", "caza", "pesca", "residuos", "parque natural"]):
        return "Medio Ambiente"
    elif any(palabra in texto for palabra in ["urbanismo", "vivienda", "suelo", "obras", "carreteras"]):
        return "Urbanismo e Infraestructuras"
    elif any(palabra in texto for palabra in ["autorización", "licencia", "concesión", "sanitaria"]):
        return "Licencias y Autorizaciones"
    else:
        return "General"

# Dirección del canal oficial RSS del BOJA
url_boja = "https://www.juntadeandalucia.es/boja/distribucion/s51.xml"
feed = feedparser.parse(url_boja)

# Guardar cada anuncio en Supabase con su categoría
for entry in feed.entries:
    titulo = entry.get('title', 'Sin título')
    link = entry.get('link', '')
    
    categoria = obtener_categoria(titulo)
    
    data = {
        "titulo": titulo,
        "url_pdf": link,
        "categoria": categoria
    }
    supabase.table("anuncios_boja").insert(data).execute()

print("¡Lectura y categorización del BOJA completadas con éxito!")
