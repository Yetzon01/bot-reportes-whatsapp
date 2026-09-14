const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// =============== CONFIGURACIÓN TELEGRAM ===============
const TELEGRAM_TOKEN = '8952498024:AAE8T6JoQq3t1l70JIWvvbUkdyyUwQgXifw';
const CHAT_ID = '-1004417748357';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

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

        // ===== CASO 1: Hay fotos → enviar como ÁLBUM =====
        if (fotos && Array.isArray(fotos) && fotos.length > 0) {
            const media = [];

            for (let i = 0; i < fotos.length; i++) {
                const pureBase64 = fotos[i].replace(/^data:image\/\w+;base64,/, '');
                
                const item = {
                    type: 'photo',
                    media: `data:image/jpeg;base64,${pureBase64}`
                };

                // El texto del reporte va como caption SOLO en la primera foto
                if (i === 0 && texto) {
                    item.caption = texto;
                    item.parse_mode = 'HTML';
                }

                media.push(item);
            }

            // Telegram no acepta data:URI directo en media group de forma confiable,
            // así que subimos las fotos una por una con InputFile usando FormData
            // Método más estable: enviar con sendMediaGroup usando URLs o archivos

            // ---- Método estable: enviar álbum con FormData ----
            const form = new FormData();
            form.append('chat_id', CHAT_ID);

            const mediaJson = [];

            for (let i = 0; i < fotos.length; i++) {
                const pureBase64 = fotos[i].replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(pureBase64, 'base64');
                const filename = `foto${i + 1}.jpg`;

                form.append(filename, new Blob([buffer], { type: 'image/jpeg' }), filename);

                const mediaItem = {
                    type: 'photo',
                    media: `attach://${filename}`
                };

                if (i === 0 && texto) {
                    mediaItem.caption = texto.substring(0, 1024); // límite de caption de Telegram
                    mediaItem.parse_mode = 'HTML';
                }

                mediaJson.push(mediaItem);
            }

            form.append('media', JSON.stringify(mediaJson));

            const response = await fetch(`${TELEGRAM_API}/sendMediaGroup`, {
                method: 'POST',
                body: form
            });

            const data = await response.json();

            if (!data.ok) {
                console.error('Error sendMediaGroup:', data);
                throw new Error(data.description || 'Error enviando álbum');
            }

            console.log('🎉 Álbum de fotos enviado correctamente');
            return res.json({ ok: true, mensaje: 'Reporte enviado como álbum a Telegram' });
        }

        // ===== CASO 2: Solo texto =====
        const resTexto = await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: texto,
                parse_mode: 'HTML'
            })
        });

        const dataTexto = await resTexto.json();
        if (!dataTexto.ok) throw new Error(dataTexto.description || 'Error enviando texto');

        console.log('✅ Texto enviado');
        res.json({ ok: true, mensaje: 'Reporte de texto enviado' });

    } catch (err) {
        console.error('❌ Error en /enviar-reporte:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Keep-alive
const MI_URL = process.env.RENDER_EXTERNAL_URL || 'https://bot-reportes-vi97.onrender.com';
setInterval(() => {
    fetch(`${MI_URL}/estado`).catch(() => {});
}, 4 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Telegram (álbum) en puerto ${PORT}`);
});
