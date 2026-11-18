const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
process.env.LUAU_AST_BIN = '/app/bin/luau-ast';

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '_' + file.originalname);
    }
});
const upload = multer({ storage: storage });

if (!fs.existsSync('output')) fs.mkdirSync('output', { recursive: true });

const ENGINES = {
    luraph: { name: 'Luraph (Caomod)', category: 'Luraph' },
    larp_v15: { name: 'Luraph v15 (Larpcorrupt)', category: 'Luraph' },
    larp_v14: { name: 'Luraph v14.x (Larpcorrupt)', category: 'Luraph' },
    wearedevs: { name: 'WeAreDevs (Prometheus)', category: 'WeAreDevs' },
    moonsec: { name: 'MoonSec V2/V3 (0x251)', category: 'MoonSec' }
};

app.get('/api/engines', (req, res) => {
    res.json(ENGINES);
});

function runEngine(engine, mode, inputPath, outputPath, res, originalName) {
    let command = '';
    const safeInput = `"${inputPath}"`;
    const safeOutput = `"${outputPath}"`;

    if (engine === 'luraph') {
        if (mode === 'normal') {
            command = `node deob.js ${safeInput} --no-hooks --timeout 1200 --budget 1200 -o ${safeOutput}`;
        } else {
            command = `node deob.js ${safeInput} --no-devirt --no-hooks -o ${safeOutput}`;
        }
    } else if (engine === 'larp_v15') {
        command = `cd larp/Deobfuscator/deobf && python3 deob.py "../../../${inputPath}" -o "../../../${outputPath}" --obfuscator luraph_v15`;
    } else if (engine === 'larp_v14') {
        command = `cd larp/Deobfuscator/deobf && python3 cli.py "../../../${inputPath}" -o "../../../${outputPath}" --trace-fallback`;
    } else if (engine === 'wearedevs') {
        command = `node prometheus/bin/pdeobf.js ${safeInput} -o ${safeOutput}`;
    } else if (engine === 'moonsec') {
        // PAKE 0x251 (Python). Output-nya ke console, jadi kita redirect ke file.
        command = `cd moon_py && python3 pol.py "../${inputPath}" > "../${outputPath}"`;
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
}

app.post('/api/deobfuscate', upload.single('luaFile'), (req, res) => {
    if (!req.file) return res.status(400).send('File tidak ditemukan');
    const inputPath = req.file.path;
    const originalName = req.file.originalname;
    const outputPath = `output/deob_${Date.now()}_${originalName}`;
    const engine = req.body.engine || 'luraph';
    const mode = req.body.mode || 'flash';
    runEngine(engine, mode, inputPath, outputPath, res, originalName);
});

app.post('/api/deobfuscate-url', async (req, res) => {
    const { url, engine, mode } = req.body;
    if (!url) return res.status(400).send('URL kosong');
    try {
        const response = await axios.get(url, { responseType: 'text' });
        const code = response.data;
        if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });
        const originalName = 'from_url.lua';
        const inputPath = path.join('uploads', `${Date.now()}_${originalName}`);
        fs.writeFileSync(inputPath, code);
        const outputPath = `output/deob_${Date.now()}_${originalName}`;
        runEngine(engine || 'luraph', mode || 'flash', inputPath, outputPath, res, originalName);
    } catch (err) {
        res.status(500).send(`Gagal download URL: ${err.message}`);
    }
});

app.listen(port, () => {
    console.log(`Server jalan di port ${port}`);
});