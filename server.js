const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
process.env.LUAU_AST_BIN = '/app/bin/luau-ast';

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

    const engine = req.body.engine || 'luraph';
    const mode = req.body.mode || 'flash';
    
    let command = '';

    if (engine === 'wearedevs') {
        command = `node prometheus/bin/pdeobf.js "${inputPath}" -o "${outputPath}"`;
    } else if (engine === 'larp_v15') {
        // ENGINE V15: Panggil deob.py dengan plugin luraph_v15
        command = `cd larp && python3 deobf/deob.py "../${inputPath}" -o "../${outputPath}" --obfuscator luraph_v15`;
    } else if (engine === 'larp') {
        // ENGINE V14: Panggil cli.py dengan --engine 14.7
        command = `cd larp/Deobfuscator/deobf && python3 cli.py "../../../${inputPath}" -o "../../../${outputPath}" --engine 14.7 --trace-fallback`;
    } else {
        // CAOMOD (LURAPH)
        if (mode === 'normal') {
            command = `node deob.js "${inputPath}" --no-hooks --timeout 1200 --budget 1200 -o "${outputPath}"`;
        } else {
            command = `node deob.js "${inputPath}" --no-devirt --no-hooks -o "${outputPath}"`;
        }
    }

    exec(command, { timeout: 300000 }, (error, stdout, stderr) => {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);

        if (error) {
            console.error(`Error: ${error.message}`);
            return res.status(500).send(`Gagal memproses: ${stderr || error.message}\n\nLog Output:\n${stdout}`);
        }

        res.download(outputPath, `deob_${engine}_${originalName}`, (err) => {
            if (err) console.error(err);
            setTimeout(() => { 
                if(fs.existsSync(outputPath)) fs.unlinkSync(outputPath) 
            }, 10000);
        });
    });
});

app.listen(port, () => {
    console.log(`Server jalan di port ${port}`);
});
