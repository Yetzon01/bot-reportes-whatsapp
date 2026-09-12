const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const CODIGO_INVITACION = 'HAojKl9A0AlLsoLF8FFsiZ'; // Tu grupo
let sock = null;
let idGrupoDestino = null;
let ultimoQR = null;
let botConectado = false;

// Conexión con WhatsApp
async function iniciarBotWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            ultimoQR = qr;
            console.log('📢 Nuevo QR generado. Visita /qr en tu navegador para escanearlo.');
        }

        if (connection === 'close') {
            botConectado = false;
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) iniciarBotWhatsApp();
        } else if (connection === 'open') {
            botConectado = true;
            ultimoQR = null;
            console.log('✅ ¡BOT CONECTADO CON ÉXITO A WHATSAPP!');
            try {
                idGrupoDestino = await sock.groupAcceptInvite(CODIGO_INVITACION);
                console.log('✅ ¡Bot unido al grupo exitosamente! ID:', idGrupoDestino);
            } catch (err) {
                console.log('ℹ️ El bot ya estaba en el grupo o se unirá por ID.');
            }
        }
    });
}

// Pantalla web para escanear el QR nítido desde cualquier navegador
app.get('/qr', (req, res) => {
    if (botConectado) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"><title>Bot Conectado</title></head>
            <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f0f2f5;">
                <div style="background:white;padding:40px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.1);text-align:center;">
                    <h1 style="color:#25D366;margin:0 0 10px 0;">✅ ¡Bot Conectado con Éxito!</h1>
                    <p style="color:#555;font-size:16px;">Tu WhatsApp ya está vinculado y listo para enviar los reportes al grupo.</p>
                </div>
            </body>
            </html>
        `);
    }

    if (!ultimoQR) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Generando QR...</title></head>
            <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f0f2f5;">
                <div style="background:white;padding:40px;border-radius:16px;text-align:center;">
                    <h2 style="color:#555;">⏳ Generando código QR de WhatsApp...</h2>
                    <p style="color:#888;">Espera unos segundos (esta pantalla se actualiza automáticamente)...</p>
                </div>
            </body>
            </html>
        `);
    }

    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&margin=15&data=${encodeURIComponent(ultimoQR)}`;

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta http-equiv="refresh" content="15">
            <title>Vincular WhatsApp - Bot SIG</title>
        </head>
        <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0f2f5;padding:20px;box-sizing:border-box;">
            <div style="background:white;padding:30px;border-radius:16px;box-shadow:0 4px 25px rgba(0,0,0,0.1);text-align:center;max-width:420px;width:100%;">
                <h2 style="color:#128C7E;margin:0 0 10px 0;">Vincular Bot con WhatsApp</h2>
                <p style="color:#666;font-size:14px;margin-bottom:20px;">
                    En tu teléfono: <b>Ajustes (o 3 puntos)</b> ➔ <b>Dispositivos vinculados</b> ➔ <b>Vincular un dispositivo</b> y apunta la cámara a este código:
                </p>
                <div style="background:#fff;padding:10px;display:inline-block;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.08);">
                    <img src="${qrImageUrl}" alt="Código QR WhatsApp" style="width:280px;height:280px;display:block;">
                </div>
                <p style="color:#888;font-size:12px;margin-top:20px;">🔄 Se renueva automáticamente si no lo escaneas a tiempo.</p>
            </div>
        </body>
        </html>
    `);
});

// Ruta raíz
app.get('/', (req, res) => {
    res.send('🤖 Bot de Reportes Ambientales SIG está ACTIVO y FUNCIONANDO. Visita <a href="/qr">/qr</a> para vincular.');
});

// Ruta que recibe el reporte desde tu página web
app.post('/enviar-reporte', async (req, res) => {
    try {
        const { texto, fotos } = req.body;

        if (!sock || !botConectado) {
            return res.status(500).json({ error: 'El bot aún no está conectado a WhatsApp.' });
        }

        if (!idGrupoDestino) {
            try {
                idGrupoDestino = await sock.groupAcceptInvite(CODIGO_INVITACION);
            } catch (e) {
                const grupos = await sock.groupFetchAllParticipating();
                for (let gid in grupos) {
                    if (grupos[gid].subject && grupos[gid].subject.toUpperCase().includes('AMBIENTAL')) {
                        idGrupoDestino = gid;
                        break;
                    }
                }
            }
        }

        if (!idGrupoDestino) {
            return res.status(500).json({ error: 'No se pudo localizar el grupo de destino.' });
        }

        // 1. Enviar el texto formateado
        await sock.sendMessage(idGrupoDestino, { text: texto });

        // 2. Enviar las 3 fotografías adjuntas si vienen incluidas
        if (fotos && Array.isArray(fotos) && fotos.length > 0) {
            for (let i = 0; i < fotos.length; i++) {
                const base64Data = fotos[i].replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                await sock.sendMessage(idGrupoDestino, {
                    image: buffer,
                    caption: `📸 Fotografía de Evidencia ${i + 1} de ${fotos.length}`
                });
            }
        }

        console.log('📢 ¡Reporte y fotos entregados al grupo de WhatsApp con éxito!');
        res.json({ ok: true, mensaje: 'Reporte publicado en el grupo de WhatsApp exitosamente.' });
    } catch (error) {
        console.error('Error al enviar reporte:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor del bot escuchando en puerto ${PORT}`);
    iniciarBotWhatsApp();
});
