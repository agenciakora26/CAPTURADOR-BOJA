import os
import time
import unicodedata
import feedparser
import resend
from supabase import create_client, Client
from google import genai

# Conexión con Supabase
raw_url = os.environ.get("SUPABASE_URL", "")
url = raw_url.replace("/rest/v1", "").rstrip("/")
key: str = os.environ.get("SUPABASE_KEY", "")
supabase: Client = create_client(url, key)

# Conexión con Resend (Envío de Emails)
resend.api_key = os.environ.get("RESEND_API_KEY", "")

# Conexión con Google Gemini (IA Gratuita)
client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

# Limpiador de texto para tildes
def limpiar_texto(texto):
    texto = texto.lower()
    texto = unicodedata.normalize('NFD', texto)
    return ''.join(c for c in texto if unicodedata.category(c) != 'Mn')

# Función de IA Semántica con control de pausas para la cuota gratuita
def ia_considera_interesante(titulo_noticia, descripcion_noticia, intereses_usuario):
    """
    Usa el modelo gratuito de Gemini para decidir si una noticia del BOJA 
    es relevante para los intereses específicos de un usuario.
    """
    prompt = f"""
    Eres un asistente legal experto en el BOJA (Boletín Oficial de la Junta de Andalucía).
    Analiza la siguiente noticia y determina si es de verdadero interés para un usuario 
    que se ha suscrito a los siguientes temas o intereses: {intereses_usuario}.
    
    Título de la noticia: {titulo_noticia}
    Contenido/Resumen: {descripcion_noticia}
    
    Responde estrictamente con la palabra "SÍ" si tiene relación directa o temática con sus intereses, o "NO" si no guarda ninguna relación.
    """
    
    try:
        response = client.models.generate_content(
            model='gemini-1.5-flash',
            contents=prompt,
        )
        # Pausa de 4 segundos para respetar los límites de la cuota gratuita por minuto (RPM)
        time.sleep(4)
        
        resultado = response.text.strip().upper()
        return "SÍ" in resultado
    except Exception as e:
        print(f"Error consultando la IA para la noticia '{titulo_noticia}': {e}")
        time.sleep(4)
        return False

# 1. Cargar RSS BOJA
url_boja = "https://www.juntadeandalucia.es/boja/distribucion/s51.xml"
feed = feedparser.parse(url_boja)

# 2. Cargar perfiles de usuarios
usuarios = supabase.table("perfiles_usuarios").select("*").execute().data

# Contador de alertas por usuario hoy
alertas_hoy = {usr["id"]: 0 for usr in usuarios}

# 3. Procesar anuncios, evaluar con IA y registrar notificaciones web
print(f"Lector BOJA con IA iniciado. Procesando {len(feed.entries)} publicaciones...")

for entry in feed.entries:
    titulo = entry.get('title', 'Sin título')
    link = entry.get('link', '')
    descripcion = entry.get('summary', '') or entry.get('description', '')
    
    # Guardamos el anuncio de forma general en la base de datos
    supabase.table("anuncios_boja").insert({
        "titulo": titulo,
        "url_pdf": link,
        "categoria": "IA Semántica"
    }).execute()
    
    # Comparamos la noticia de forma inteligente con cada usuario usando Gemini
    for usr in usuarios:
        intereses = usr.get("sectores_suscritos") or []
        
        if not intereses:
            continue # Si el usuario no tiene intereses definidos, saltamos
            
        # Llamada a la IA gratuita para validación semántica
        es_relevante = ia_considera_interesante(titulo, descripcion, intereses)
        
        if es_relevante:
            mensaje = f"Novedad de tu interés: {titulo[:80]}..."
            supabase.table("notificaciones_web").insert({
                "usuario_id": usr["id"],
                "mensaje": mensaje,
                "leida": False
            }).execute()
            alertas_hoy[usr["id"]] += 1

# 4. Enviar Email "Gancho" a usuarios con novedades detectadas por la IA
print(f"Comprobando envíos de emails para {len(usuarios)} usuarios registrados...")

for usr in usuarios:
    total = alertas_hoy.get(usr["id"], 0)
    print(f"Usuario {usr['email']}: {total} alertas relevantes hoy.")
    
    if total > 0:
        print(f"Intentando enviar email a {usr['email']}...")
        try:
            respuesta = resend.Emails.send({
                "from": "boletinhoy.es <alertas@boletinhoy.es>",
                "to": [usr["email"]],
                "subject": f"🔔 Tienes {total} nuevas publicaciones inteligentes de tu interés",
                "html": f"""
                    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                        <h2 style="color: #2563eb;">¡Hola!</h2>
                        <p>La IA ha detectado <strong>{total} nuevos anuncios</strong> en el BOJA que encajan exactamente con tus intereses personalizados.</p>
                        <p>Entra en tu panel privado para ver el desglose completo y los enlaces directos:</p>
                        <p style="margin-top: 25px;">
                            <a href="https://boletinhoy.es" style="background-color: #2563eb; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Ver novedades en boletinhoy.es</a>
                        </p>
                        <br><br>
                        <hr style="border: none; border-top: 1px solid #eee;">
                        <small style="color: #777;">Alertas inteligentes enviadas por boletinhoy.es</small>
                    </div>
                """
            })
            print(f"✅ Email enviado con éxito a {usr['email']}. Respuesta: {respuesta}")
        except Exception as e:
            print(f"❌ ERROR al enviar email a {usr['email']}: {e}")
    else:
        print(f"ℹ️ No se envía email a {usr['email']} porque no hay novedades relevantes.")

print("¡Proceso diario del BOJA con IA completado con éxito!")
