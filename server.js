const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const CODIGO_INVITACION = 'HAojKl9A0AlLsoLF8FFsiZ';
let sock = null;
let idGrupo = null;
let qrActual = null;
let conectado = false;

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false });
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrActual = qr;

        if (connection === 'close') {
            conectado = false;
            const reconectar = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (reconectar) iniciarBot();
        } else if (connection === 'open') {
            conectado = true;
            qrActual = null;
            console.log('✅ Bot conectado a WhatsApp');
            try {
                idGrupo = await sock.groupAcceptInvite(CODIGO_INVITACION);
            } catch (e) {
                const grupos = await sock.groupFetchAllParticipating();
                for (let g in grupos) {
                    if (grupos[g].subject && grupos[g].subject.toUpperCase().includes('AMBIENTAL')) {
                        idGrupo = g;
                        break;
                    }
                }
            }
        }
    });
}

// Pantalla del código QR nítido
app.get('/qr', (req, res) => {
    if (conectado) {
        return res.send('<h1 style="color:#25D366;text-align:center;margin-top:20vh;font-family:sans-serif;">✅ ¡Bot Conectado con Éxito a WhatsApp!</h1>');
    }
    if (!qrActual) {
        return res.send('<h2 style="text-align:center;margin-top:20vh;font-family:sans-serif;">⏳ Generando código QR... Espera unos segundos.<script>setTimeout(()=>location.reload(),4000)</script></h2>');
    }
    const img = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=15&data=${encodeURIComponent(qrActual)}`;
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="15"><title>QR Bot WhatsApp</title></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;font-family:sans-serif;background:#f0f2f5;"><div style="background:#fff;padding:25px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.1);text-align:center;max-width:380px;"><h2 style="color:#128c7e;margin:0 0 10px 0;">Vincular Bot con WhatsApp</h2><p style="color:#666;font-size:14px;margin-bottom:15px;">Abre WhatsApp ➔ <b>Dispositivos vinculados</b> y escanea:</p><img src="${img}" style="width:280px;height:280px;border-radius:12px;border:2px solid #128c7e;"><p style="color:#999;font-size:12px;margin-top:15px;">Se actualiza automáticamente.</p></div></body></html>`);
});

app.get('/', (req, res) => res.send('🤖 Bot ACTIVO. Entra a <a href="/qr">/qr</a> para vincular.'));

app.post('/enviar-reporte', async (req, res) => {
    try {
        const { texto, fotos } = req.body;
        if (!sock || !conectado) return res.status(500).json({ error: 'El bot aún no está conectado.' });

        if (!idGrupo) {
            try { idGrupo = await sock.groupAcceptInvite(CODIGO_INVITACION); } catch(e){}
        }
        if (!idGrupo) return res.status(500).json({ error: 'No se encontró el grupo.' });

        await sock.sendMessage(idGrupo, { text: texto });

        if (fotos && Array.isArray(fotos)) {
            for (let i = 0; i < fotos.length; i++) {
                const b64 = fotos[i].replace(/^data:image\/\w+;base64,/, '');
                await sock.sendMessage(idGrupo, {
                    image: Buffer.from(b64, 'base64'),
                    caption: `📸 Evidencia ${i + 1} de ${fotos.length}`
                });
            }
        }
        res.json({ ok: true, mensaje: 'Reporte entregado con éxito' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor en puerto ${PORT}`);
    iniciarBot();
});
