const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// Setup Luau untuk Caomod (Luraph)
process.env.LUAU_AST_BIN = '/app/bin/luau-ast';

// Setup Multer untuk upload file
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

app.post('/api/deobfuscate', upload.single('luaFile'), (req, res) => {
    if (!req.file) return res.status(400).send('File tidak ditemukan');

    const inputPath = req.file.path;
    const originalName = req.file.originalname;
    const outputPath = `output/deob_${Date.now()}_${originalName}`;

    // Nangkep pilihan engine dari frontend
    const engine = req.body.engine || 'luraph';
    const mode = req.body.mode || 'flash';
    
    let command = '';

    if (engine === 'wearedevs') {
        // PAKE PROMETHEUS (WeAreDevs)
        command = `node prometheus/bin/pdeobf.js "${inputPath}" -o "${outputPath}"`;
    } else if (engine === 'larp') {
        // PAKE LARPCORRUPT (Luraph v14.x Spesialis)
        // Path dibenerin sesuai dokumentasi: masuk ke Deobfuscator/deobf dulu
        // Pake ../../../ buat balik ke folder /app tempat file upload & output
        command = `cd larp/Deobfuscator/deobf && python3 cli.py "../../../${inputPath}" -o "../../../${outputPath}"`;
    } else {
        // PAKE CAOMOD (Luraph)
        if (mode === 'normal') {
            command = `node deob.js "${inputPath}" --no-hooks --timeout 1200 --budget 1200 -o "${outputPath}"`;
        } else {
            command = `node deob.js "${inputPath}" --no-devirt --no-hooks -o "${outputPath}"`;
        }
    }

    exec(command, { timeout: 300000 }, (error, stdout, stderr) => {
        // Hapus file input sementara
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);

        if (error) {
            console.error(`Error: ${error.message}`);
            // Tampilin log stdout & stderr biar kita tau apa yang dilakuin Python
            return res.status(500).send(`Gagal memproses: ${stderr || error.message}\n\nLog Output:\n${stdout}`);
        }

        // Kirim file hasil download
        res.download(outputPath, `deob_${engine}_${originalName}`, (err) => {
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
