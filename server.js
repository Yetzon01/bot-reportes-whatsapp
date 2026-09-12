const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const CODIGO_INVITACION = 'HAojKl9A0AlLsoLF8FFsiZ';
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const SUPABASE_URL = 'https://zezcmftcbbzplhtdqotd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bNaRcykfZaVdW67HsEf3Tw_rWemQCui';

let sock = null;
let idGrupo = null;
let qrActual = null;
let conectado = false;

// 1. Restaurar sesión permanente desde Supabase al iniciar
async function restaurarSesionDesdeSupabase() {
    try {
        if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/mapas_comunales?usuario_email=eq.bot_whatsapp_session&select=geometria_mapa`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        const data = await resp.json();
        if (data && data.length > 0 && data[0].geometria_mapa && data[0].geometria_mapa.archivos_auth) {
            const archivos = data[0].geometria_mapa.archivos_auth;
            for (let nombre in archivos) {
                fs.writeFileSync(path.join(AUTH_DIR, nombre), archivos[nombre], 'utf8');
            }
            console.log('✅ Sesión de WhatsApp restaurada desde Supabase.');
        }
    } catch (e) {
        console.log('ℹ️ Iniciando sesión nueva...');
    }
}

// 2. Guardar sesión permanente en Supabase (solo 15 KB de texto)
let temporizadorGuardado = null;
function programarGuardadoSesion() {
    clearTimeout(temporizadorGuardado);
    temporizadorGuardado = setTimeout(async () => {
        try {
            if (!fs.existsSync(AUTH_DIR)) return;
            const archivos = fs.readdirSync(AUTH_DIR);
            const archivosData = {};
            for (let f of archivos) {
                const ruta = path.join(AUTH_DIR, f);
                if (fs.statSync(ruta).isFile()) {
                    archivosData[f] = fs.readFileSync(ruta, 'utf8');
                }
            }
            const body = JSON.stringify({
                usuario_email: 'bot_whatsapp_session',
                id_comuna: 'SISTEMA_BOT',
                nombre_sector: 'AUTH_SESSION',
                geometria_mapa: { archivos_auth: archivosData }
            });

            const check = await fetch(`${SUPABASE_URL}/rest/v1/mapas_comunales?usuario_email=eq.bot_whatsapp_session&select=id`, {
                headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
            });
            const filas = await check.json();
            if (filas && filas.length > 0) {
                await fetch(`${SUPABASE_URL}/rest/v1/mapas_comunales?id=eq.${filas[0].id}`, {
                    method: 'PATCH',
                    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                    body
                });
            } else {
                await fetch(`${SUPABASE_URL}/rest/v1/mapas_comunales`, {
                    method: 'POST',
                    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                    body
                });
            }
            console.log('💾 Sesión de WhatsApp respaldada permanentemente.');
        } catch (err) {}
    }, 2500);
}

// 3. Conexión WhatsApp
async function iniciarBot() {
    await restaurarSesionDesdeSupabase();
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', () => {
        saveCreds();
        programarGuardadoSesion();
    });

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
            console.log('✅ ¡BOT CONECTADO A WHATSAPP!');
            programarGuardadoSesion();
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

// Pantalla web QR
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

app.get('/', (req, res) => res.send('🤖 Bot ACTIVO y PERMANENTE. Entra a <a href="/qr">/qr</a> para vincular.'));

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

// Auto-ping cada 9 minutos para que Render NUNCA se duerma
const MI_URL = 'https://bot-reportes-vi97.onrender.com';
setInterval(() => {
    fetch(MI_URL).catch(() => {});
}, 9 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor en puerto ${PORT}`);
    iniciarBot();
});
