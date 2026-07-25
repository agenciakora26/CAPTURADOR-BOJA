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

def limpiar_texto(texto):
    if not texto:
        return ""
    texto = texto.lower()
    texto = unicodedata.normalize('NFD', texto)
    return ''.join(c for c in texto if unicodedata.category(c) != 'Mn')

# DICCIONARIO DE SECTORES HIPER-ACOTADOS
DICCIONARIO_SECTORES = {
    "oposiciones y empleo público": [
        "oposicion", "oposiciones", "empleo publico", "bolsa de trabajo", "funcionario", 
        "personal funcionario", "personal laboral fijo", "oferta de empleo publico", 
        "toma de posesion", "nombramiento", "cuerpos de funcionarios", "escala de funcionarios",
        "pruebas selectivas", "concurso-oposicion"
    ],
    "subvenciones y ayudas": [
        "subvencion", "subvenciones", "bases reguladoras de subvenciones", "concesion de subvenciones", 
        "ayudas directas", "incentivos a la", "prórroga de plazo de solicitud", 
        "extracto de la resolucion de", "beneficiarios de subvenciones"
    ],
    "agricultura y pesca": [
        "agricultura", "pesca", "ganaderia", "politica agraria comun", "pac", 
        "explotacion agraria", "desarrollo rural", "sector pesquero", "ayudas agrarias",
        "produccion agricola", "sanidad animal", "acuicultura"
    ],
    "hosteleria y comercio": [
        "hosteleria", "comercio", "turismo", "establecimientos turisticos", "restauracion",
        "hoteles", "agencias de viajes", "comercio interior", "artesania", "mercados de abastos"
    ],
    "licitaciones y contratacion": [
        "licitacion", "contratacion publica", "contrato menor", "mesa de contratacion", 
        "pliego de clausulas administrativas", "adjudicacion de contrato", "formalizacion de contrato",
        "procedimiento abierto", "acuerdo marco"
    ]
}

def evaluar_coincidencia_estricta(texto_noticia, intereses_usuario):
    texto_limpio = limpiar_texto(texto_noticia)
    
    for interes in intereses_usuario:
        interes_limpio = limpiar_texto(interes)
        
        palabras_clave = []
        for clave_maestra, terminos in DICCIONARIO_SECTORES.items():
            if clave_maestra in interes_limpio or interes_limpio in clave_maestra:
                palabras_clave.extend(terminos)
                break
        
        if not palabras_clave:
            palabras_clave = [interes_limpio]
            
        for palabra in palabras_clave:
            if palabra and palabra in texto_limpio:
                return True
                
    return False

def descargar_y_analizar_pdf_futuro(url_pdf):
    """
    HOOK PARA FUTURA VERSIÓN:
    Aquí se implementará la descarga del PDF mediante peticiones HTTP y 
    la extracción de texto para un segundo nivel de validación más profundo.
    """
    # TODO: Implementar descarga de PDF y análisis avanzado de texto en v2
    pass

# 1. Cargar URLs existentes en Supabase para evitar duplicados absolutos
print("Comprobando anuncios ya registrados en Supabase...")
existing_records = supabase.table("anuncios_boja").select("url_pdf").execute().data
urls_existentes = {record["url_pdf"] for record in existing_records}
print(f"Se encontraron {len(urls_existentes)} anuncios previos en la base de datos.")

# 2. Cargar RSS BOJA
url_boja = "https://www.juntadeandalucia.es/boja/distribucion/s51.xml"
feed = feedparser.parse(url_boja)

# 3. Cargar perfiles de usuarios desde Supabase
usuarios = supabase.table("perfiles_usuarios").select("*").execute().data

# Contador de alertas exclusivo para la ejecución actual
alertas_hoy = {usr["id"]: 0 for usr in usuarios}

print(f"Lector BOJA iniciado. Analizando {len(feed.entries)} publicaciones del feed...")

anuncios_a_insertar = []
notificaciones_a_insertar = []

for entry in feed.entries:
    link = entry.get('link', '')
    
    # Si la URL del PDF ya existe en la base de datos, la ignoramos por completo
    if link in urls_existentes:
        continue

    titulo = entry.get('title', 'Sin título')
    descripcion = entry.get('summary', '') or entry.get('description', '')
    
    texto_completo = f"{titulo} {descripcion}"
    
    # [FUTURA VERSIÓN]: Llamada preparada para el análisis de PDF si fuera necesario
    # texto_pdf_extraido = descargar_y_analizar_pdf_futuro(link)
    # if texto_pdf_extraido: texto_completo += " " + texto_pdf_extraido

    # Acumulamos el nuevo anuncio para inserción masiva
    anuncios_a_insertar.append({
        "titulo": titulo,
        "url_pdf": link,
        "categoria": "Filtro Estricto"
    })
    
    # Cruzamos con los intereses de los usuarios en memoria
    for usr in usuarios:
        intereses_raw = usr.get("sectores_suscritos") or []
        if not intereses_raw:
            continue
            
        if evaluar_coincidencia_estricta(texto_completo, intereses_raw):
            mensaje = f"Novedad de tu interés: {titulo[:80]}..."
            notificaciones_a_insertar.append({
                "usuario_id": usr["id"],
                "mensaje": mensaje,
                "leida": False
            })
            alertas_hoy[usr["id"]] += 1

# 4. Inserciones masivas en Supabase de las nuevas publicaciones
if anuncios_a_insertar:
    try:
        supabase.table("anuncios_boja").insert(anuncios_a_insertar).execute()
        print(f"✅ {len(anuncios_a_insertar)} nuevos anuncios guardados en Supabase.")
    except Exception as e:
        print(f"❌ Error insertando anuncios en lote: {e}")
else:
    print("ℹ️ No hay anuncios nuevos que añadir en esta ejecución.")

if notificaciones_a_insertar:
    try:
        supabase.table("notificaciones_web").insert(notificaciones_a_insertar).execute()
        print(f"✅ {len(notificaciones_a_insertar)} nuevas notificaciones web creadas.")
    except Exception as e:
        print(f"❌ Error insertando notificaciones en lote: {e}")

# 5. Enviar Email exclusivamente por las novedades detectadas en esta ejecución
print(f"Comprobando envíos de emails para {len(usuarios)} usuarios...")

for usr in usuarios:
    total = alertas_hoy.get(usr["id"], 0)
    print(f"Usuario {usr['email']}: {total} alertas relevantes en esta ejecución.")
    
    if total > 0:
        print(f"Intentando enviar email a {usr['email']}...")
        try:
            respuesta = resend.Emails.send({
                "from": "boletinhoy.es <alertas@boletinhoy.es>",
                "to": [usr["email"]],
                "subject": f"🔔 Tienes {total} nuevas publicaciones específicas de tu interés",
                "html": f"""
                    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                        <h2 style="color: #2563eb;">¡Hola!</h2>
                        <p>Hemos detectado <strong>{total} nuevos anuncios</strong> en esta revisión que coinciden exactamente con tus sectores.</p>
                        <p>Entra en tu panel privado para ver los detalles:</p>
                        <p style="margin-top: 25px;">
                            <a href="https://boletinhoy.es" style="background-color: #2563eb; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Ver novedades en boletinhoy.es</a>
                        </p>
                        <br><br>
                        <hr style="border: none; border-top: 1px solid #eee;">
                        <small style="color: #777;">Alertas automáticas enviadas por boletinhoy.es</small>
                    </div>
                """
            })
            print(f"✅ Email enviado con éxito a {usr['email']}. Respuesta: {respuesta}")
        except Exception as e:
            print(f"❌ ERROR al enviar email a {usr['email']}: {e}")
    else:
        print(f"ℹ️ No se envía email a {usr['email']} porque no hay novedades en esta ejecución.")

print("¡Proceso completado con éxito sin duplicados!")
