const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// =============== CONFIGURACIÓN TELEGRAM ===============
const TELEGRAM_TOKEN = '8952498024:AAE8T6JoQq3t1l70JIWvvbUkdyyUwQgXifw';
const CHAT_ID = '-1004417748357'; // Grupo: REPORTE GIGP MUNICIPIO SIMÓN BOLÍVAR
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// =============== FUNCIONES TELEGRAM ===============
async function enviarMensajeTelegram(texto) {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: CHAT_ID,
            text: texto,
            parse_mode: 'HTML'
        })
    });
    return res.json();
}

async function enviarFotoTelegram(base64, caption = '') {
    // Convertir base64 a buffer
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Crear FormData manualmente
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const parts = [];

    // chat_id
    parts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="chat_id"\r\n\r\n` +
        `${CHAT_ID}\r\n`
    );

    // caption (solo en la primera foto)
    if (caption) {
        parts.push(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="caption"\r\n\r\n` +
            `${caption}\r\n`
        );
        parts.push(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="parse_mode"\r\n\r\n` +
            `HTML\r\n`
        );
    }

    // foto
    parts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="photo"; filename="reporte.jpg"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n`
    );

    const bodyStart = Buffer.from(parts.join(''), 'utf8');
    const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const body = Buffer.concat([bodyStart, buffer, bodyEnd]);

    const res = await fetch(`${TELEGRAM_API}/sendPhoto`, {
        method: 'POST',
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length
        },
        body: body
    });

    return res.json();
}

// =============== RUTAS ===============
app.get('/', (req, res) => {
    res.send(`
        <h2>🤖 Bot de Reportes - Telegram</h2>
        <p>Estado: <b>ACTIVO</b></p>
        <p><a href="/estado">Ver estado</a></p>
    `);
});

app.get('/estado', (req, res) => {
    res.json({
        ok: true,
        plataforma: 'Telegram',
        chat_id: CHAT_ID,
        uptimeProcesoSeg: Math.round(process.uptime()),
        mensaje: 'Bot de Telegram funcionando correctamente'
    });
});

// === Endpoint principal (compatible con tu index.html) ===
app.post('/enviar-reporte', async (req, res) => {
    try {
        const { texto, fotos } = req.body;

        if (!texto && (!fotos || fotos.length === 0)) {
            return res.status(400).json({ error: 'No se recibió texto ni fotos' });
        }

        // Si hay fotos
        if (fotos && Array.isArray(fotos) && fotos.length > 0) {
            for (let i = 0; i < fotos.length; i++) {
                const caption = i === 0 ? (texto || '') : '';
                const resultado = await enviarFotoTelegram(fotos[i], caption);

                if (!resultado.ok) {
                    console.error('Error enviando foto:', resultado);
                    return res.status(500).json({ error: 'Error al enviar foto a Telegram', detalle: resultado });
                }

                // Pequeña pausa entre fotos
                if (i < fotos.length - 1) {
                    await new Promise(r => setTimeout(r, 300));
                }
            }
        } else {
            // Solo texto
            const resultado = await enviarMensajeTelegram(texto);
            if (!resultado.ok) {
                console.error('Error enviando mensaje:', resultado);
                return res.status(500).json({ error: 'Error al enviar mensaje a Telegram', detalle: resultado });
            }
        }

        console.log('✅ Reporte enviado correctamente a Telegram');
        res.json({ ok: true, mensaje: 'Reporte entregado con éxito a Telegram' });

    } catch (err) {
        console.error('❌ Error en /enviar-reporte:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// =============== KEEP-ALIVE (para Render) ===============
const MI_URL = process.env.RENDER_EXTERNAL_URL || 'https://bot-reportes-vi97.onrender.com';

setInterval(() => {
    fetch(`${MI_URL}/estado`).catch(() => {});
}, 4 * 60 * 1000); // cada 4 minutos

// =============== INICIAR SERVIDOR ===============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Telegram corriendo en puerto ${PORT}`);
    console.log(`📱 Enviando reportes al grupo: ${CHAT_ID}`);
});
