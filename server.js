const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// --- SETUP LUAU-AST (Paksa ngarah ke folder /app/bin) ---
process.env.LUAU_AST_BIN = '/app/bin/luau-ast';
// --------------------------------------------------------

// Setup penyimpanan Multer biar ekstensi file gak ilang
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '_' + file.originalname);
    }
});
const upload = multer({ storage: storage });

if (!fs.existsSync('output')) fs.mkdirSync('output');

// Endpoint buat proses file
app.post('/api/deobfuscate', upload.single('luaFile'), (req, res) => {
    if (!req.file) return res.status(400).send('File tidak ditemukan');

    const inputPath = req.file.path;
    const originalName = req.file.originalname;
    const outputPath = `output/deob_${Date.now()}_${originalName}`;

    // Pakai --no-devirt biar ringan dan cepet di Railway
    const command = `node deob.js "${inputPath}" --no-devirt -o "${outputPath}"`;

    exec(command, { timeout: 300000 }, (error, stdout, stderr) => {
        // Hapus file input sementara
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);

        if (error) {
            console.error(`Error: ${error.message}`);
            return res.status(500).send(`Gagal memproses: ${stderr || error.message}`);
        }

        // Kirim file hasil download
        res.download(outputPath, `deob_${originalName}`, (err) => {
            if (err) console.error(err);
            // Hapus file output setelah 10 detik
            setTimeout(() => { 
                if(fs.existsSync(outputPath)) fs.unlinkSync(outputPath) 
            }, 10000);
        });
    });
});

app.listen(port, () => {
    console.log(`Server jalan di port ${port}`);
});
