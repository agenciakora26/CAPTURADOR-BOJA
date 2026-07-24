import os
import unicodedata
import feedparser
from supabase import create_client, Client

# Conexión con Supabase
raw_url = os.environ.get("SUPABASE_URL", "")
url = raw_url.replace("/rest/v1", "").rstrip("/")
key: str = os.environ.get("SUPABASE_KEY", "")
supabase: Client = create_client(url, key)

# Función para quitar tildes y mayúsculas
def limpiar_texto(texto):
    texto = texto.lower()
    texto = unicodedata.normalize('NFD', texto)
    return ''.join(c for c in texto if unicodedata.category(c) != 'Mn')

# Función para clasificar por sectores
def obtener_categoria(titulo):
    texto = limpiar_texto(titulo)
    
    if any(p in texto for p in ["oposicion", "oposiciones", "nombramiento", "personal", "bolsa de trabajo", "plaza", "pruebas selectivas", "resolucion"]):
        return "Oposiciones y Empleo"
    elif any(p in texto for p in ["subvencion", "subvenciones", "ayuda", "incentivo", "beca", "financiacion", "extracto"]):
        return "Subvenciones y Ayudas"
    elif any(p in texto for p in ["licitacion", "contratacion", "adjudicacion", "contrato", "pliego"]):
        return "Contratación Pública"
    elif any(p in texto for p in ["medio ambiente", "forestal", "agua", "caza", "pesca", "residuos", "parque natural"]):
        return "Medio Ambiente"
    elif any(p in texto for p in ["urbanismo", "vivienda", "suelo", "obras", "carreteras"]):
        return "Urbanismo e Infraestructuras"
    elif any(p in texto for p in ["autorizacion", "licencia", "concesion", "sanitaria"]):
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

print("¡Proceso completado!")
