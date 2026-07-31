import { runCapturadorBoja } from './capturador.js'; // Asegúrate de exportar la función en tu capturador.js actual
import { runCapturadorBoe } from './capturador-boe.js'; // Asegúrate de exportar la función en tu capturador-boe.js actual
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

async function ejecutarProcesoDiario() {
    console.log("Iniciando captura unificada BOJA y BOE...");

    let alertasBoja = [];
    let alertasBoe = [];

    // 1. Ejecutar BOJA y capturar sus resultados
    try {
        if (typeof runCapturadorBoja === 'function') {
            alertasBoja = await runCapturadorBoja(); 
        }
    } catch (err) {
        console.error("Error en BOJA:", err);
    }

    // 2. Ejecutar BOE y capturar sus resultados
    try {
        if (typeof runCapturadorBoe === 'function') {
            alertasBoe = await runCapturadorBoe();
        }
    } catch (err) {
        console.error("Error en BOE:", err);
    }

    const totalBoja = alertasBoja ? alertasBoja.length : 0;
    const totalBoe = alertasBoe ? alertasBoe.length : 0;
    const totalAlertas = totalBoja + totalBoe;

    if (totalAlertas === 0) {
        console.log("No hay nuevas alertas ni en BOJA ni en BOE hoy. No se envía correo.");
        return;
    }

    // 3. Construir el HTML unificado con diseño diferenciado
    let htmlBojaContent = totalBoja > 0 
        ? alertasBoja.map(item => `<p style="margin: 5px 0;"><a href="${item.url}" target="_blank" style="color: #047857; text-decoration: none;">• ${item.titulo}</a></p>`).join('')
        : '<p style="color: #666; font-style: italic; margin: 0;">No hay nuevas alertas en el BOJA hoy.</p>';

    let htmlBoeContent = totalBoe > 0 
        ? alertasBoe.map(item => `<p style="margin: 5px 0;"><a href="${item.url}" target="_blank" style="color: #1d4ed8; text-decoration: none;">• ${item.titulo}</a></p>`).join('')
        : '<p style="color: #666; font-style: italic; margin: 0;">No hay nuevas alertas en el BOE hoy.</p>';

    const htmlFinal = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1e293b; text-align: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">Resumen Diario Oficial</h2>
        <p style="font-size: 14px; color: #475569;">Se han detectado nuevas publicaciones en los boletines oficiales:</p>
        
        <!-- BLOQUE BOJA (VERDE) -->
        <div style="border-left: 4px solid #10b981; background-color: #f0fdf4; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
            <h3 style="color: #047857; margin-top: 0; font-size: 16px;">🟢 BOJA (Andalucía) - ${totalBoja} novedades</h3>
            ${htmlBojaContent}
        </div>

        <!-- BLOQUE BOE (AZUL) -->
        <div style="border-left: 4px solid #3b82f6; background-color: #eff6ff; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
            <h3 style="color: #1d4ed8; margin-top: 0; font-size: 16px;">🔵 BOE (Estado) - ${totalBoe} novedades</h3>
            ${htmlBoeContent}
        </div>

        <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 30px;">BoletínHoy - Automatización de Alertas Oficiales</p>
    </div>`;

    // 4. Enviar un único correo con Resend
    try {
        const asunto = `Tienes ${totalAlertas} alertas nuevas en tu BOE y BOJA`;
        
        await resend.emails.send({
            from: 'BoletínHoy <onboarding@resend.dev>', // O tu dominio configurado en Resend
            to: 'tucorreo@tuemail.com', // Cambia por tu dirección de destino
            subject: asunto,
            html: htmlFinal
        });

        console.log("Correo unificado enviado con éxito.");
    } catch (emailErr) {
        console.error("Error al enviar el correo con Resend:", emailErr);
    }
}

ejecutarProcesoDiario();
