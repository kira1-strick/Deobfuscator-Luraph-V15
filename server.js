
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const OUTPUT_DIR = path.join(ROOT, 'output');

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const PROCESS_TIMEOUT = 300000;

process.env.LUAU_AST_BIN =
    process.env.LUAU_AST_BIN || '/app/bin/luau-ast';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const ENGINES = {
    luraph: {
        name: 'Luraph (Caomod)',
        category: 'Luraph'
    },
    larp_v15: {
        name: 'Luraph v15 (Larpcorrupt)',
        category: 'Luraph'
    },
    larp_v14: {
        name: 'Luraph v14.x (Larpcorrupt)',
        category: 'Luraph'
    },
    wearedevs: {
        name: 'WeAreDevs (Prometheus)',
        category: 'WeAreDevs'
    },
    moonsec: {
        name: 'MoonSec V2/V3 (0x251)',
        category: 'MoonSec'
    }
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },

    filename: (req, file, cb) => {
        const safeName = path
            .basename(file.originalname)
            .replace(/[^a-zA-Z0-9._-]/g, '_');

        cb(null, `${Date.now()}_${safeName}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1
    }
});

app.get('/api/engines', (req, res) => {
    res.json(ENGINES);
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        engines: Object.keys(ENGINES),
        timestamp: new Date().toISOString()
    });
});

// ==========================================
// INPUT VALIDATION
// ==========================================

function validateLuaFile(inputPath) {
    if (!fs.existsSync(inputPath)) {
        throw new Error('Input file tidak ditemukan');
    }

    const stat = fs.statSync(inputPath);

    if (stat.size === 0) {
        throw new Error('File kosong');
    }

    const content = fs.readFileSync(inputPath, 'utf8')
        .replace(/^\uFEFF/, '')
        .trim();

    if (!content) {
        throw new Error('File tidak memiliki konten');
    }

    if (/^(<!doctype html|<html|<head|<body)/i.test(content)) {
        throw new Error(
            'Input adalah HTML, bukan source Lua'
        );
    }

    if (content.includes('\0')) {
        throw new Error('File mengandung null byte');
    }

    return true;
}

// ==========================================
// PROCESS EXECUTOR
// ==========================================

function execute(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: ROOT,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            ...options
        });

        let stdout = '';
        let stderr = '';
        let finished = false;
        let timedOut = false;

        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');

            setTimeout(() => {
                if (!finished) {
                    child.kill('SIGKILL');
                }
            }, 5000);

        }, PROCESS_TIMEOUT);

        child.stdout.on('data', data => {
            stdout += data.toString();
        });

        child.stderr.on('data', data => {
            stderr += data.toString();
        });

        child.on('error', err => {
            if (finished) return;

            finished = true;
            clearTimeout(timeout);

            reject({
                message: err.message,
                stdout,
                stderr
            });
        });

        child.on('close', (code, signal) => {
            if (finished) return;

            finished = true;
            clearTimeout(timeout);

            if (timedOut) {
                return reject({
                    message: 'Process timeout',
                    stdout,
                    stderr
                });
            }

            if (code !== 0) {
                return reject({
                    message: `Process exited with code ${code}`,
                    signal,
                    stdout,
                    stderr
                });
            }

            resolve({
                code,
                stdout,
                stderr
            });
        });
    });
}

// ==========================================
// ENGINE COMMANDS
// ==========================================

function getEngineCommand(engine, mode, inputPath, outputPath) {
    const relativeInput = path.relative(ROOT, inputPath);
    const relativeOutput = path.relative(ROOT, outputPath);

    switch (engine) {

        case 'luraph': {
            const args = [
                'deob.js',
                relativeInput
            ];

            if (mode === 'flash') {
                args.push('--no-devirt');
            } else {
                args.push(
                    '--timeout', '1200',
                    '--budget', '1200'
                );
            }

            args.push('-o', relativeOutput);

            return {
                command: 'node',
                args
            };
        }

        case 'larp_v15':
            return {
                command: 'python3',
                args: [
                    'deob.py',
                    `../../../${relativeInput}`,
                    '-o',
                    `../../../${relativeOutput}`,
                    '--obfuscator',
                    'luraph_v15'
                ],
                cwd: path.join(ROOT, 'larp/Deobfuscator/deobf')
            };

        case 'larp_v14':
            return {
                command: 'python3',
                args: [
                    'cli.py',
                    `../../../${relativeInput}`,
                    '-o',
                    `../../../${relativeOutput}`,
                    '--trace-fallback'
                ],
                cwd: path.join(ROOT, 'larp/Deobfuscator/deobf')
            };

        case 'wearedevs':
            return {
                command: 'node',
                args: [
                    'prometheus/bin/pdeobf.js',
                    inputPath,
                    '-o',
                    outputPath
                ]
            };

        case 'moonsec':
            return {
                command: 'python3',
                args: [
                    'pol.py',
                    `../${relativeInput}`
                ],
                cwd: path.join(ROOT, 'moon_py'),
                moonsec: true
            };

        default:
            throw new Error('Engine tidak dikenal');
    }
}

// ==========================================
// MAIN PROCESS
// ==========================================

async function runEngine(
    engine,
    mode,
    inputPath,
    outputPath,
    res,
    originalName
) {
    let completed = false;

    try {
        if (!Object.hasOwn(ENGINES, engine)) {
            throw new Error('Engine tidak valid');
        }

        if (!['normal', 'flash'].includes(mode)) {
            throw new Error('Mode tidak valid');
        }

        validateLuaFile(inputPath);

        const config = getEngineCommand(
            engine,
            mode,
            inputPath,
            outputPath
        );

        console.log(`[ENGINE] ${engine}`);
        console.log(`[MODE] ${mode}`);
        console.log(`[INPUT] ${inputPath}`);

        let result;

        if (config.moonsec) {
            const { command, args, cwd } = config;

            result = await execute(command, args, {
                cwd,
                env: process.env
            });

            fs.writeFileSync(
                outputPath,
                result.stdout,
                'utf8'
            );
        } else {
            result = await execute(
                config.command,
                config.args,
                config.cwd ? { cwd: config.cwd } : {}
            );
        }

        if (!fs.existsSync(outputPath)) {
            throw new Error(
                'Engine selesai tetapi output tidak ditemukan'
            );
        }

        const outputStat = fs.statSync(outputPath);

        if (outputStat.size === 0) {
            throw new Error('Output engine kosong');
        }

        completed = true;

        console.log(
            `[SUCCESS] ${engine}: ${outputStat.size} bytes`
        );

        res.download(
            outputPath,
            `deob_${engine}_${path.basename(originalName)}`,
            err => {
                if (err) {
                    console.error('[DOWNLOAD ERROR]', err.message);
                }

                cleanup(inputPath, outputPath);
            }
        );

    } catch (error) {
        console.error(`[ENGINE ERROR] ${engine}`);
        console.error(error.message);

        if (error.stdout) {
            console.error('[STDOUT]', error.stdout);
        }

        if (error.stderr) {
            console.error('[STDERR]', error.stderr);
        }

        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                engine,
                mode,
                status: 'FAILED',
                error: error.message,
                stdout: error.stdout || '',
                stderr: error.stderr || ''
            });
        }

        cleanup(inputPath, outputPath);
    }
}

// ==========================================
// CLEANUP
// ==========================================

function cleanup(...files) {
    for (const file of files) {
        if (!file) continue;

        try {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        } catch (err) {
            console.error('[CLEANUP]', err.message);
        }
    }
}

// ==========================================
// UPLOAD ENDPOINT
// ==========================================

app.post(
    '/api/deobfuscate',
    upload.single('luaFile'),
    (req, res) => {

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'File tidak ditemukan'
            });
        }

        const inputPath = req.file.path;
        const originalName = req.file.originalname;

        const engine = req.body.engine || 'luraph';
        const mode = req.body.mode || 'normal';

        const outputName =
            `deob_${Date.now()}_${path.basename(originalName)}.lua`;

        const outputPath = path.join(
            OUTPUT_DIR,
            outputName
        );

        runEngine(
            engine,
            mode,
            inputPath,
            outputPath,
            res,
            originalName
        );
    }
);

// ==========================================
// URL ENDPOINT
// ==========================================

app.post(
    '/api/deobfuscate-url',
    async (req, res) => {

        const {
            url,
            engine = 'luraph',
            mode = 'normal'
        } = req.body || {};

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL kosong'
            });
        }

        if (!Object.hasOwn(ENGINES, engine)) {
            return res.status(400).json({
                success: false,
                error: 'Engine tidak valid'
            });
        }

        let parsed;

        try {
            parsed = new URL(url);

            if (
                !['http:', 'https:'].includes(parsed.protocol)
            ) {
                throw new Error('Protocol URL tidak valid');
            }

        } catch {
            return res.status(400).json({
                success: false,
                error: 'Format URL tidak valid'
            });
        }

        let inputPath;

        try {
            const response = await axios.get(url, {
                responseType: 'text',
                timeout: 20000,
                maxContentLength: MAX_FILE_SIZE,
                maxBodyLength: MAX_FILE_SIZE,
                maxRedirects: 3,
                headers: {
                    'User-Agent': 'Lua-Deobfuscator/1.0'
                }
            });

            const code = response.data;

            if (typeof code !== 'string') {
                throw new Error('Response bukan teks Lua');
            }

            inputPath = path.join(
                UPLOAD_DIR,
                `${Date.now()}_from_url.lua`
            );

            fs.writeFileSync(inputPath, code, 'utf8');

            const outputPath = path.join(
                OUTPUT_DIR,
                `deob_${Date.now()}_from_url.lua`
            );

            runEngine(
                engine,
                mode,
                inputPath,
                outputPath,
                res,
                'from_url.lua'
            );

        } catch (error) {
            if (inputPath) {
                cleanup(inputPath);
            }

            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: `Gagal download URL: ${error.message}`
                });
            }
        }
    }
);

// ==========================================
// ERROR HANDLER
// ==========================================

app.use((err, req, res, next) => {
    console.error('[SERVER ERROR]', err.message);

    if (err instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            error: err.code === 'LIMIT_FILE_SIZE'
                ? 'Ukuran file maksimal 15 MB'
                : err.message
        });
    }

    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// ==========================================
// START SERVER
// ==========================================

app.listen(port, () => {
    console.log('================================');
    console.log('Lua Deobfuscator API');
    console.log(`Port: ${port}`);
    console.log(`Root: ${ROOT}`);
    console.log('Engines:', Object.keys(ENGINES).join(', '));
    console.log('================================');
});
