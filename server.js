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
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const reconectar = statusCode !== DisconnectReason.loggedOut;
            console.log(`⚠️ Conexión cerrada. Código: ${statusCode}. Reconectar: ${reconectar}`);
            if (reconectar) {
                setTimeout(() => iniciarBot(), 3000);
            } else {
                console.log('⚠️ Sesión cerrada en WhatsApp. Limpiando credenciales locales...');
                try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch(e){}
                setTimeout(() => iniciarBot(), 3000);
            }
        } else if (connection === 'open') {
            conectado = true;
            qrActual = null;
            console.log('✅ ¡BOT CONECTADO A WHATSAPP!');
            programarGuardadoSesion();
            try {
                const info = await sock.groupGetInviteInfo(CODIGO_INVITACION);
                if (info && info.id) {
                    idGrupo = info.id.includes('@g.us') ? info.id : `${info.id}@g.us`;
                    console.log(`✅ Grupo identificado por código: ${info.subject || ''} (${idGrupo})`);
                }
                await sock.groupAcceptInvite(CODIGO_INVITACION);
            } catch (e) {
                console.log('ℹ️ Info grupo invitación:', e.message);
                if (!idGrupo) {
                    try {
                        const grupos = await sock.groupFetchAllParticipating();
                        for (let g in grupos) {
                            idGrupo = g;
                            console.log(`✅ Grupo recuperado de chats activos: ${idGrupo}`);
                            break;
                        }
                    } catch(errG) {}
                }
            }
        }
    });
}

// Estado del Bot para verificación desde el mapa
app.get('/estado', (req, res) => {
    res.json({
        ok: true,
        conectado: conectado,
        tieneQr: !!qrActual,
        idGrupo: idGrupo || null
    });
});

// Pantalla web QR
app.get('/qr', (req, res) => {
    if (conectado) {
        return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bot Conectado</title></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;font-family:sans-serif;background:#0d1117;color:#fff;"><div style="background:#161b22;padding:30px;border-radius:16px;border:1px solid #238636;text-align:center;max-width:420px;"><h1 style="color:#2ea043;margin:0 0 15px 0;font-size:24px;">✅ ¡Bot Conectado a WhatsApp!</h1><p style="color:#8b949e;font-size:14px;line-height:1.5;">El bot del Sistema SIG Ecosocial está activo y listo para recibir y publicar reportes de riesgos ambientales en el grupo.</p><div style="margin-top:20px;padding:10px;background:#21262d;border-radius:8px;font-size:12px;color:#58a6ff;">Grupo ID: ${idGrupo || 'Conectado'}</div></div></body></html>`);
    }
    if (!qrActual) {
        return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>Generando QR...</title></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;font-family:sans-serif;background:#0d1117;color:#fff;"><div style="background:#161b22;padding:30px;border-radius:16px;border:1px solid #30363d;text-align:center;max-width:400px;"><h2 style="color:#e6edf3;margin:0 0 10px 0;">⏳ Iniciando Bot...</h2><p style="color:#8b949e;font-size:14px;">Generando código QR de vinculación. Esta página se recargará automáticamente en unos segundos.</p></div></body></html>`);
    }
    const img = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=15&data=${encodeURIComponent(qrActual)}`;
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="15"><title>QR Bot WhatsApp</title></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;font-family:sans-serif;background:#0d1117;color:#fff;"><div style="background:#161b22;padding:30px;border-radius:16px;border:2px solid #238636;box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center;max-width:380px;"><h2 style="color:#2ea043;margin:0 0 10px 0;">Vincular Bot con WhatsApp</h2><p style="color:#8b949e;font-size:13.5px;margin-bottom:15px;">Abre WhatsApp en tu teléfono ➔ <b>Dispositivos vinculados</b> ➔ <b>Vincular un dispositivo</b> y escanea:</p><img src="${img}" style="width:280px;height:280px;border-radius:12px;border:2px solid #238636;background:#fff;padding:8px;"><p style="color:#6e7681;font-size:12px;margin-top:15px;">🔄 Se actualiza automáticamente cada 15 segundos.</p></div></body></html>`);
});

app.get('/', (req, res) => res.send('🤖 Bot ACTIVO y PERMANENTE. Entra a <a href="/qr">/qr</a> para vincular.'));

// 4. Enviar reporte al grupo de WhatsApp
//    ESTRATEGIA: Fotos SIN caption + texto como mensaje aparte = 4 mensajes que se ven juntos como un bloque
app.post('/enviar-reporte', async (req, res) => {
    try {
        const { texto, fotos } = req.body;
        if (!sock || !conectado) return res.status(500).json({ error: 'El bot aún no está conectado a WhatsApp.' });

        if (!idGrupo) {
            try {
                const info = await sock.groupGetInviteInfo(CODIGO_INVITACION);
                if (info && info.id) {
                    idGrupo = info.id.includes('@g.us') ? info.id : `${info.id}@g.us`;
                }
                await sock.groupAcceptInvite(CODIGO_INVITACION);
            } catch(e){
                try {
                    const grupos = await sock.groupFetchAllParticipating();
                    for (let g in grupos) {
                        idGrupo = g;
                        break;
                    }
                } catch(errG) {}
            }
        }
        if (!idGrupo) return res.status(500).json({ error: 'No se encontró el grupo de WhatsApp. Asegúrate de que el bot esté en el grupo.' });

        if (fotos && Array.isArray(fotos) && fotos.length > 0) {
            // PASO 1: Preparar todos los buffers de imagen SIN caption
            const mensajesImg = fotos.map((foto) => {
                const b64 = foto.replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(b64, 'base64');
                return { image: buffer };
            });

            // PASO 2: Enviar las 3 fotos SIMULTÁNEAMENTE sin texto
            //         Al no tener caption y llegar juntas, WhatsApp las agrupa como álbum/collage
            const promesasFotos = mensajesImg.map((msg) => sock.sendMessage(idGrupo, msg));
            await Promise.all(promesasFotos);

            // PASO 3: Enviar el texto del reporte inmediatamente después
            //         Como viene del mismo remitente justo después del álbum,
            //         WhatsApp lo muestra pegado al álbum formando un solo bloque visual
            if (texto) {
                await sock.sendMessage(idGrupo, { text: texto });
            }
        } else {
            await sock.sendMessage(idGrupo, { text: texto });
        }

        res.json({ ok: true, mensaje: 'Reporte entregado como álbum con éxito' });
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
