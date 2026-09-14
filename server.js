const express = require('express');
const cors = require('cors');
const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const TELEGRAM_TOKEN = '8952498024:AAE8T6JoQq3t1l70JIWvvbUkdyyUwQgXifw';
const CHAT_ID = '-1004417748357';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

app.get('/', (req, res) => {
    res.send('<h2>🤖 Bot Telegram ACTIVO (Álbum)</h2><a href="/estado">/estado</a>');
});

app.get('/estado', (req, res) => {
    res.json({
        ok: true,
        plataforma: 'Telegram',
        modo: 'album',
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

        // ===== Si hay fotos → ÁLBUM =====
        if (fotos && Array.isArray(fotos) && fotos.length > 0) {
            const form = new FormData();
            form.append('chat_id', CHAT_ID);

            const media = [];

            for (let i = 0; i < fotos.length; i++) {
                const pure = fotos[i].replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(pure, 'base64');
                const filename = `foto${i + 1}.jpg`;

                form.append(filename, buffer, {
                    filename: filename,
                    contentType: 'image/jpeg'
                });

                const item = {
                    type: 'photo',
                    media: `attach://${filename}`
                };

                // Caption solo en la primera foto (máx 1024 caracteres)
                if (i === 0 && texto) {
                    item.caption = texto.length > 1000 
                        ? texto.substring(0, 1000) + '...' 
                        : texto;
                    item.parse_mode = 'HTML';
                }

                media.push(item);
            }

            form.append('media', JSON.stringify(media));

            const response = await fetch(`${TELEGRAM_API}/sendMediaGroup`, {
                method: 'POST',
                body: form,
                headers: form.getHeaders()
            });

            const data = await response.json();

            if (!data.ok) {
                console.error('Error álbum:', data);
                throw new Error(data.description || 'Error al enviar álbum');
            }

            console.log('🎉 Álbum enviado correctamente');
            
            // Si el texto era muy largo y se cortó, enviamos el resto después
            if (texto && texto.length > 1000) {
                await fetch(`${TELEGRAM_API}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: CHAT_ID,
                        text: '📄 Continuación del reporte:\n\n' + texto.substring(1000),
                        parse_mode: 'HTML'
                    })
                });
            }

            return res.json({ ok: true, mensaje: 'Reporte enviado como álbum' });
        }

        // ===== Solo texto (sin fotos) =====
        const r = await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: texto,
                parse_mode: 'HTML'
            })
        });
        const d = await r.json();
        if (!d.ok) throw new Error(d.description || 'Error enviando texto');

        res.json({ ok: true, mensaje: 'Texto enviado' });

    } catch (err) {
        console.error('❌ Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Keep-alive
const MI_URL = process.env.RENDER_EXTERNAL_URL || 'https://bot-reportes-vi97.onrender.com';
setInterval(() => fetch(`${MI_URL}/estado`).catch(() => {}), 4 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot Telegram (álbum) en puerto ${PORT}`));
