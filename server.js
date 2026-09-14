require('dotenv').config(); // ← necesitas instalar dotenv
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// =============== CONFIGURACIÓN (desde .env) ===============
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

if (!TELEGRAM_TOKEN || !CHAT_ID) {
    console.error('❌ Faltan TELEGRAM_TOKEN o CHAT_ID en el archivo .env');
    process.exit(1);
}

// =============== HELPERS ===============
async function enviarTexto(texto) {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: CHAT_ID,
            text: texto,
            parse_mode: 'HTML'
        })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description || 'Error enviando texto');
    return data;
}

async function enviarFotoBase64(base64, caption = '') {
    const pureBase64 = base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(pureBase64, 'base64');

    const form = new FormData();
    form.append('chat_id', CHAT_ID);
    if (caption) {
        form.append('caption', caption);
        form.append('parse_mode', 'HTML');
    }
    form.append('photo', new Blob([buffer], { type: 'image/jpeg' }), 'reporte.jpg');

    const res = await fetch(`${TELEGRAM_API}/sendPhoto`, {
        method: 'POST',
        body: form
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description || 'Error enviando foto');
    return data;
}

// =============== RUTAS ===============
app.get('/', (req, res) => {
    res.send(`
        <h2>🤖 Bot de Reportes - Telegram</h2>
        <p>Estado: <b style="color:green">ACTIVO</b></p>
        <p><a href="/estado">/estado</a></p>
    `);
});

app.get('/estado', (req, res) => {
    res.json({
        ok: true,
        plataforma: 'Telegram',
        chat_id: CHAT_ID,
        uptimeProcesoSeg: Math.round(process.uptime())
    });
});

app.post('/enviar-reporte', async (req, res) => {
    try {
        const { texto, fotos } = req.body;

        if (!texto && (!fotos || fotos.length === 0)) {
            return res.status(400).json({ error: 'No se recibió texto ni fotos' });
        }

        console.log('📩 Nuevo reporte recibido...');

        // 1. Enviar texto
        if (texto && texto.trim()) {
            await enviarTexto(texto);
            console.log('✅ Texto enviado');
        }

        // 2. Enviar fotos
        if (fotos && Array.isArray(fotos) && fotos.length > 0) {
            for (let i = 0; i < fotos.length; i++) {
                await enviarFotoBase64(fotos[i]);
                console.log(`✅ Foto ${i + 1}/${fotos.length} enviada`);

                // pequeña pausa para no saturar la API
                if (i < fotos.length - 1) {
                    await new Promise(r => setTimeout(r, 400));
                }
            }
        }

        console.log('🎉 Reporte completo enviado a Telegram');
        res.json({ ok: true, mensaje: 'Reporte entregado con éxito a Telegram' });

    } catch (err) {
        console.error('❌ Error en /enviar-reporte:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Keep-alive para Render
const MI_URL = process.env.RENDER_EXTERNAL_URL || 'https://bot-reportes-vi97.onrender.com';
setInterval(() => {
    fetch(`${MI_URL}/estado`).catch(() => {});
}, 4 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Telegram en puerto ${PORT}`);
    console.log(`📱 Grupo: ${CHAT_ID}`);
});
