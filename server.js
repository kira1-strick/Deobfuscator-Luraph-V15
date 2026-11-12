const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

const upload = multer({ dest: 'uploads/' });
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('output')) fs.mkdirSync('output');

app.post('/api/deobfuscate', upload.single('luaFile'), (req, res) => {
    if (!req.file) return res.status(400).send('File tidak ditemukan');

    const inputPath = req.file.path;
    const originalName = req.file.originalname;
    const outputPath = `output/${Date.now()}_${originalName}`;

    const command = `node deob.js "${inputPath}" --no-devirt -o "${outputPath}"`;

    exec(command, { timeout: 300000 }, (error, stdout, stderr) => {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);

        if (error) {
            console.error(`Error: ${error.message}`);
            return res.status(500).send(`Gagal memproses: ${stderr || error.message}`);
        }

        res.download(outputPath, `deob_${originalName}`, (err) => {
            if (err) console.error(err);
            setTimeout(() => { if(fs.existsSync(outputPath)) fs.unlinkSync(outputPath) }, 10000);
        });
    });
});

app.listen(port, () => {
    console.log(`Server jalan di port ${port}`);
});
