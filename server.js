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
let reconectando = false;
let intentosReconexion = 0;
const MAX_INTENTOS = 20;
let ultimaActividad = Date.now();
let ultimoIntentoConexion = 0;

// Evitar múltiples inicios simultáneos
function marcarActividad() {
    ultimaActividad = Date.now();
}

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
            return true;
        }
    } catch (e) {
        console.log('ℹ️ Iniciando sesión nueva (no había respaldo o falló la lectura)...');
    }
    return false;
}

// 2. Guardar sesión permanente en Supabase
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
        } catch (err) {
            console.log('⚠️ No se pudo respaldar sesión:', err.message);
        }
    }, 2500);
}

// Recuperar ID del grupo si se perdió
async function asegurarGrupo() {
    if (!sock || !conectado) return false;
    if (idGrupo) return true;
    try {
        const info = await sock.groupGetInviteInfo(CODIGO_INVITACION);
        if (info && info.id) {
            idGrupo = info.id.includes('@g.us') ? info.id : `${info.id}@g.us`;
            console.log(`✅ Grupo identificado: ${info.subject || ''} (${idGrupo})`);
        }
        try { await sock.groupAcceptInvite(CODIGO_INVITACION); } catch (e) {}
    } catch (e) {
        try {
            const grupos = await sock.groupFetchAllParticipating();
            for (let g in grupos) {
                idGrupo = g;
                console.log(`✅ Grupo recuperado de chats activos: ${idGrupo}`);
                break;
            }
        } catch (errG) {}
    }
    return !!idGrupo;
}

// 3. Conexión WhatsApp (más estable y agresiva al reconectar)
async function iniciarBot() {
    if (reconectando) return;
    const ahora = Date.now();
    // Evitar spam de inicios si ya se intentó hace menos de 4s
    if (ahora - ultimoIntentoConexion < 4000 && !conectado) return;
    ultimoIntentoConexion = ahora;
    reconectando = true;

    try {
        await restaurarSesionDesdeSupabase();
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        // Cerrar socket anterior si existe
        try {
            if (sock) {
                sock.ev.removeAllListeners();
                sock.end(undefined);
            }
        } catch (e) {}

        sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            keepAliveIntervalMs: 20000,
            markOnlineOnConnect: false,
            connectTimeoutMs: 45000,
            defaultQueryTimeoutMs: 45000,
            syncFullHistory: false,
            generateHighQualityLinkPreview: false
        });

        sock.ev.on('creds.update', () => {
            saveCreds();
            programarGuardadoSesion();
            marcarActividad();
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            marcarActividad();

            if (qr) {
                qrActual = qr;
                console.log('📱 QR generado');
            }

            if (connection === 'close') {
                conectado = false;
                const statusCode = (lastDisconnect?.error)?.output?.statusCode;
                const motivo = lastDisconnect?.error?.message || 'desconocido';
                console.log(`⚠️ Conexión cerrada. Código: ${statusCode} | Motivo: ${motivo}`);

                const esLogout = statusCode === DisconnectReason.loggedOut;

                if (esLogout) {
                    console.log('🚫 Sesión cerrada desde WhatsApp. Limpiando credenciales...');
                    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
                    intentosReconexion = 0;
                    reconectando = false;
                    setTimeout(() => iniciarBot(), 5000);
                } else {
                    intentosReconexion++;
                    if (intentosReconexion > MAX_INTENTOS) {
                        console.log('❌ Demasiados intentos. Esperando 90s y reiniciando contador...');
                        intentosReconexion = 0;
                        reconectando = false;
                        setTimeout(() => iniciarBot(), 90000);
                        return;
                    }
                    // Reconexión más rápida al principio
                    const delay = Math.min(2000 * Math.pow(1.4, intentosReconexion - 1), 45000);
                    console.log(`🔄 Reconectando en ${Math.round(delay / 1000)}s (intento ${intentosReconexion}/${MAX_INTENTOS})...`);
                    reconectando = false;
                    setTimeout(() => iniciarBot(), delay);
                }
            } else if (connection === 'open') {
                conectado = true;
                qrActual = null;
                intentosReconexion = 0;
                reconectando = false;
                console.log('✅ ¡BOT CONECTADO A WHATSAPP!');
                programarGuardadoSesion();
                await asegurarGrupo();
            }
        });
    } catch (err) {
        console.error('❌ Error al iniciar bot:', err.message);
        reconectando = false;
        setTimeout(() => iniciarBot(), 8000);
    }
}

// Si el bot está "vivo" en HTTP pero WhatsApp desconectado, forzar reconexión
function asegurarBotActivo() {
    marcarActividad();
    if (!conectado && !reconectando) {
        console.log('⚡ Ping recibido: WhatsApp desconectado → forzando reconexión...');
        iniciarBot();
        return false;
    }
    return conectado;
}

// Estado del Bot (UptimeRobot pega aquí cada 5 min)
app.get('/estado', (req, res) => {
    const okWa = asegurarBotActivo();
    res.json({
        ok: true,
        conectado: okWa,
        tieneQr: !!qrActual,
        idGrupo: idGrupo || null,
        uptimeProcesoSeg: Math.round(process.uptime()),
        ultimaActividad: new Date(ultimaActividad).toISOString()
    });
});

// Pantalla web QR
app.get('/qr', (req, res) => {
    asegurarBotActivo();

    if (conectado) {
        return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bot Conectado</title></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;font-family:sans-serif;background:#0d1117;color:#fff;"><div style="background:#161b22;padding:30px;border-radius:16px;border:1px solid #238636;text-align:center;max-width:420px;"><h1 style="color:#2ea043;margin:0 0 15px 0;font-size:24px;">✅ ¡Bot Conectado a WhatsApp!</h1><p style="color:#8b949e;font-size:14px;line-height:1.5;">El bot del Sistema SIG Ecosocial está activo y listo para recibir y publicar reportes de riesgos ambientales en el grupo.</p><div style="margin-top:20px;padding:10px;background:#21262d;border-radius:8px;font-size:12px;color:#58a6ff;">Grupo ID: ${idGrupo || 'Conectado'}</div></div></body></html>`);
    }
    if (!qrActual) {
        return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>Generando QR...</title></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;font-family:sans-serif;background:#0d1117;color:#fff;"><div style="background:#161b22;padding:30px;border-radius:16px;border:1px solid #30363d;text-align:center;max-width:400px;"><h2 style="color:#e6edf3;margin:0 0 10px 0;">⏳ Iniciando Bot...</h2><p style="color:#8b949e;font-size:14px;">Generando código QR de vinculación. Esta página se recargará automáticamente en unos segundos.</p></div></body></html>`);
    }
    const img = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=15&data=${encodeURIComponent(qrActual)}`;
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="15"><title>QR Bot WhatsApp</title></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;font-family:sans-serif;background:#0d1117;color:#fff;"><div style="background:#161b22;padding:30px;border-radius:16px;border:2px solid #238636;box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center;max-width:380px;"><h2 style="color:#2ea043;margin:0 0 10px 0;">Vincular Bot con WhatsApp</h2><p style="color:#8b949e;font-size:13.5px;margin-bottom:15px;">Abre WhatsApp en tu teléfono ➔ <b>Dispositivos vinculados</b> ➔ <b>Vincular un dispositivo</b> y escanea:</p><img src="${img}" style="width:280px;height:280px;border-radius:12px;border:2px solid #238636;background:#fff;padding:8px;"><p style="color:#6e7681;font-size:12px;margin-top:15px;">🔄 Se actualiza automáticamente cada 15 segundos.</p></div></body></html>`);
});

app.get('/', (req, res) => {
    asegurarBotActivo();
    res.send('🤖 Bot ACTIVO. Entra a <a href="/qr">/qr</a> para vincular. Estado: <a href="/estado">/estado</a>');
});

// 4. Enviar reporte
app.post('/enviar-reporte', async (req, res) => {
    try {
        marcarActividad();
        const { texto, fotos } = req.body;

        if (!sock || !conectado) {
            asegurarBotActivo();
            return res.status(503).json({ error: 'El bot aún no está conectado a WhatsApp. Espera unos segundos e intenta de nuevo.' });
        }

        const grupoOk = await asegurarGrupo();
        if (!grupoOk || !idGrupo) {
            return res.status(500).json({ error: 'No se encontró el grupo de WhatsApp. Asegúrate de que el bot esté en el grupo.' });
        }

        if (fotos && Array.isArray(fotos) && fotos.length > 0) {
            for (let i = 0; i < fotos.length; i++) {
                const b64 = fotos[i].replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(b64, 'base64');
                const opcionesMensaje = { image: buffer };
                if (i === 0) {
                    opcionesMensaje.caption = texto;
                }
                await sock.sendMessage(idGrupo, opcionesMensaje);
                if (i < fotos.length - 1) {
                    await new Promise(r => setTimeout(r, 300));
                }
            }
        } else {
            await sock.sendMessage(idGrupo, { text: texto });
        }

        res.json({ ok: true, mensaje: 'Reporte entregado con éxito' });
    } catch (err) {
        console.error('Error enviando reporte:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Auto-ping interno cada 4 minutos (complementa UptimeRobot cada 5 min)
const MI_URL = 'https://bot-reportes-vi97.onrender.com';
setInterval(() => {
    fetch(`${MI_URL}/estado`).catch(() => {});
}, 4 * 60 * 1000);

// Revisión periódica: si lleva mucho desconectado, forzar inicio
setInterval(() => {
    if (!conectado && !reconectando) {
        console.log('🔁 Watchdog: bot desconectado → reiniciando...');
        iniciarBot();
    }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor en puerto ${PORT}`);
    iniciarBot();
});
