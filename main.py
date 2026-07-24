import os
import unicodedata
import feedparser
import resend
from supabase import create_client, Client

# Conexión con Supabase
raw_url = os.environ.get("SUPABASE_URL", "")
url = raw_url.replace("/rest/v1", "").rstrip("/")
key: str = os.environ.get("SUPABASE_KEY", "")
supabase: Client = create_client(url, key)

# Conexión con Resend (Envío de Emails)
resend.api_key = os.environ.get("RESEND_API_KEY", "")

# Limpiador de texto para tildes
def limpiar_texto(texto):
    texto = texto.lower()
    texto = unicodedata.normalize('NFD', texto)
    return ''.join(c for c in texto if unicodedata.category(c) != 'Mn')

# Clasificador por sectores
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

# 1. Cargar RSS BOJA
url_boja = "https://www.juntadeandalucia.es/boja/distribucion/s51.xml"
feed = feedparser.parse(url_boja)

# 2. Cargar perfiles de usuarios
usuarios = supabase.table("perfiles_usuarios").select("*").execute().data

# Contador de alertas por usuario hoy
alertas_hoy = {usr["id"]: 0 for usr in usuarios}

# 3. Procesar anuncios y notificaciones
for entry in feed.entries:
    titulo = entry.get('title', 'Sin título')
    link = entry.get('link', '')
    categoria = obtener_categoria(titulo)
    
    supabase.table("anuncios_boja").insert({
        "titulo": titulo,
        "url_pdf": link,
        "categoria": categoria
    }).execute()
    
    for usr in usuarios:
        sectores = usr.get("sectores_suscritos") or []
        if categoria in sectores:
            mensaje = f"Nuevo anuncio publicado en {categoria}: {titulo[:80]}..."
            supabase.table("notificaciones_web").insert({
                "usuario_id": usr["id"],
                "mensaje": mensaje,
                "leida": False
            }).execute()
            alertas_hoy[usr["id"]] += 1

# 4. Enviar Email "Gancho" si el usuario tiene novedades hoy
for usr in usuarios:
    total = alertas_hoy.get(usr["id"], 0)
    if total > 0 and resend.api_key:
        try:
            resend.Emails.send({
                "from": "boletin.es <onboarding@resend.dev>",
                "to": [usr["email"]],
                "subject": f"🔔 Tienes {total} nuevas publicaciones de tu interés",
                "html": f"""
                    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                        <h2 style="color: #2563eb;">¡Hola!</h2>
                        <p>Hoy se han publicado <strong>{total} nuevos anuncios</strong> en el BOJA que coinciden con tus sectores de interés.</p>
                        <p>Entra en tu panel privado para ver el desglose completo y los enlaces directos:</p>
                        <p style="margin-top: 25px;">
                            <a href="https://boletin.es" style="background-color: #2563eb; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Ver novedades en boletin.es</a>
                        </p>
                        <br><br>
                        <hr style="border: none; border-top: 1px solid #eee;">
                        <small style="color: #777;">Alertas automáticas enviadas por boletin.es</small>
                    </div>
                """
            })
            print(f"Email enviado a {usr['email']}")
        except Exception as e:
            print(f"Error al enviar email: {e}")

print("¡Proceso diario completado con éxito!")
