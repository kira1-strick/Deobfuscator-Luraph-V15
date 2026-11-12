const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Izinkan akses dari web mana aja (CORS)
app.use(cors());

// Paksa luau-ast ngarah ke folder bin di dalam Docker
process.env.LUAU_AST_BIN = '/app/bin/luau-ast';

// Setup penyimpanan Multer (biar ekstensi .lua gak ilang)
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

// Bikin folder output kalau belum ada
if (!fs.existsSync('output')) fs.mkdirSync('output');

// Endpoint utama buat nerima file dari web
app.post('/api/deobfuscate', upload.single('luaFile'), (req, res) => {
    if (!req.file) return res.status(400).send('File tidak ditemukan');

    const inputPath = req.file.path;
    const originalName = req.file.originalname;
    const outputPath = `output/deob_${Date.now()}_${originalName}`;

    // Nangkep mode dari frontend (default: flash)
    const mode = req.body.mode || 'flash';
    
    let command = '';
    if (mode === 'normal') {
        // MODE NORMAL: Full Devirtualize (Bongkar kode utuh, lama, butuh RAM)
        command = `node deob.js "${inputPath}" --no-hooks -o "${outputPath}"`;
    } else {
        // MODE FLASH: Cuma rekam jejak (Cepet, ringan)
        command = `node deob.js "${inputPath}" --no-devirt --no-hooks -o "${outputPath}"`;
    }

    // Jalanin perintah deob.js
    exec(command, { timeout: 300000 }, (error, stdout, stderr) => {
        // Hapus file input sementara
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);

        if (error) {
            console.error(`Error: ${error.message}`);
            return res.status(500).send(`Gagal memproses: ${stderr || error.message}`);
        }

        // Kirim file hasil
        res.download(outputPath, `deob_${mode}_${originalName}`, (err) => {
            if (err) console.error(err);
            // Hapus file output setelah 10 detik biar server gak penuh
            setTimeout(() => { 
                if(fs.existsSync(outputPath)) fs.unlinkSync(outputPath) 
            }, 10000);
        });
    });
});

// Nyalain server
app.listen(port, () => {
    console.log(`Server jalan di port ${port}`);
});
