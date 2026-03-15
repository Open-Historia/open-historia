import express from 'express';
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const distDir = path.join(__dirname, '../dist');
const savesDir = path.join(distDir, 'saves');

// Make sure saves directory exists
fs.mkdirSync(path.join(savesDir, 'save0', 'storage'), { recursive: true });

app.use(express.static(distDir));
app.use(express.text({ type: '*/*' }));

// **Handle PUT requests manually**
app.use((req, res, next) => {
    if (req.method !== 'PUT') return next();
    if (!req.path.startsWith('/saves/')) return res.status(404).json({ error: 'Not Found' });

    const relativePath = req.path.replace(/^\/saves\//, '');
    const filePath = path.join(savesDir, relativePath);

    if (!filePath.startsWith(savesDir)) return res.status(403).json({ error: 'Forbidden' });

    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, req.body, 'utf-8');
        return res.json({ ok: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// SPA fallback
app.get('*splat', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});




