const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const CODIGO_INVITACION = 'HAojKl9A0AlLsoLF8FFsiZ'; // Tu grupo
let sock = null;
let idGrupoDestino = null;

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
            console.log("\n==================================================");
            console.log("ESCANEA ESTE CÓDIGO QR CON EL TELÉFONO DEL BOT:");
            console.log("==================================================");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) iniciarBotWhatsApp();
        } else if (connection === 'open') {
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

// Ruta para probar que el servidor está vivo
app.get('/', (req, res) => {
    res.send('🤖 Bot de Reportes Ambientales SIG está ACTIVO y FUNCIONANDO.');
});

// Ruta que recibe el reporte desde tu página web
app.post('/enviar-reporte', async (req, res) => {
    try {
        const { texto, fotos } = req.body;

        if (!sock) {
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
