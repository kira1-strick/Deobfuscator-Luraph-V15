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

// ==========================================
// DAFTAR ENGINE & KATEGORI (BUAT FRONTEND)
// ==========================================
const ENGINES = {
    luraph: { name: 'Luraph (Caomod)', category: 'Luraph', mode: ['flash', 'normal'] },
    larp_v15: { name: 'Luraph v15 (Larpcorrupt)', category: 'Luraph', mode: [] },
    larp_v14: { name: 'Luraph v14.7-14.9 (Larpcorrupt)', category: 'Luraph', mode: [] },
    meh_v15: { name: 'Luraph v15.1 (MehCake)', category: 'Luraph', mode: [] },
    binx_v14: { name: 'Luraph v14.7 (Binx)', category: 'Luraph', mode: [] },
    wearedevs: { name: 'WeAreDevs (Prometheus)', category: 'WeAreDevs', mode: [] },
    moonsec: { name: 'MoonSec V3 (MokaEZF)', category: 'MoonSec', mode: [] },
    ironbrew: { name: 'IronBrew2 (Pirateware)', category: 'IronBrew', mode: [] }
};

// Endpoint buat ngirim daftar engine ke frontend
app.get('/api/engines', (req, res) => {
    res.json(ENGINES);
});

// ==========================================
// FUNGSI EKSEKUSI ENGINE
// ==========================================
function runEngine(engine, mode, inputPath, outputPath, res, originalName) {
    let command = '';
    const safeInput = `"${inputPath}"`;
    const safeOutput = `"${outputPath}"`;

    // LURAPH
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
    } else if (engine === 'meh_v15') {
        // Asumsi MehCake pake python dan nerima argumen -o
        command = `cd meh_v15 && python3 main.py "../${inputPath}" -o "../${outputPath}"`;
    } else if (engine === 'binx_v14') {
        // Asumsi Binx pake python dan nerima argumen -o
        command = `cd binx_v14 && python3 deobf.py "../${inputPath}" -o "../${outputPath}"`;
    
    // WEAREDEVS
    } else if (engine === 'wearedevs') {
        command = `node prometheus/bin/pdeobf.js ${safeInput} -o ${safeOutput}`;
    
    // MOONSEC
    } else if (engine === 'moonsec') {
        // Panggil wrapper .mjs yang bakal kita bikin nanti
        command = `cd moonsec && node run.mjs "../${inputPath}" "../${outputPath}"`;
    
    // IRONBREW (Placeholder, karena tool aslinya C#)
    } else if (engine === 'ironbrew') {
        // Nanti kalo udah di-compile, panggil .exe / .dll nya di sini
        command = `dotnet ironbrew/IronbrewDeobfuscator.dll -t ib2 -f ${safeInput} -o ${safeOutput}`;
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

// ==========================================
// ENDPOINT UPLOAD FILE
// ==========================================
app.post('/api/deobfuscate', upload.single('luaFile'), (req, res) => {
    if (!req.file) return res.status(400).send('File tidak ditemukan');

    const inputPath = req.file.path;
    const originalName = req.file.originalname;
    const outputPath = `output/deob_${Date.now()}_${originalName}`;
    const engine = req.body.engine || 'luraph';
    const mode = req.body.mode || 'flash';

    runEngine(engine, mode, inputPath, outputPath, res, originalName);
});

// ==========================================
// ENDPOINT URL
// ==========================================
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