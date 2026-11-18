'use strict';

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const ipaddr = require('ipaddr.js');
const PQueue = require('p-queue').default;
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const dns = require('dns');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

// ============================ CONFIG ============================
const ROOT = __dirname;
const cfg = {
  port: +process.env.PORT || 3000,
  maxBytes: (+process.env.MAX_FILE_MB || 5) * 1024 * 1024,
  concurrency: +process.env.CONCURRENCY || 2,
  maxQueue: +process.env.MAX_QUEUE || 10,
  deadlineMs: +process.env.JOB_DEADLINE_MS || 270000, // total waktu per request (Railway ~300s)
  cacheTtlMs: (+process.env.CACHE_TTL_MIN || 60) * 60000,
  rateLimit: +process.env.RATE_LIMIT || 20, // request / menit / IP
  origins: (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
  astBin: process.env.LUAU_AST_BIN || path.join(ROOT, 'bin', 'luau-ast'),
};

const WORK = path.join(os.tmpdir(), 'deobf-work');
const CACHE = path.join(os.tmpdir(), 'deobf-cache');
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

const AST_OK = fs.existsSync(cfg.astBin);
if (!AST_OK) console.warn(`[warn] luau-ast tidak ditemukan di ${cfg.astBin} — validasi sintaks dinonaktifkan`);

const childEnv = {
  PATH: process.env.PATH,
  HOME: os.tmpdir(),
  LANG: 'C.UTF-8',
  LUAU_AST_BIN: cfg.astBin,
  NODE_OPTIONS: '--max-old-space-size=1024',
  PYTHONUNBUFFERED: '1',
  PYTHONDONTWRITEBYTECODE: '1',
};

// ============================ ENGINES ============================
// Semua argumen dikirim sebagai array (tanpa shell) -> aman dari command injection.
const ENGINES = {
  luraph: (i, o, mode) => ({
    cmd: 'node',
    args: ['deob.js', i, ...(mode === 'normal'
      ? ['--no-hooks', '--timeout', '1200', '--budget', '1200']
      : ['--no-devirt', '--no-hooks']), '-o', o],
    cwd: ROOT,
  }),
  wearedevs: (i, o) => ({
    cmd: 'node',
    args: [path.join(ROOT, 'prometheus/bin/pdeobf.js'), i, '-o', o],
    cwd: ROOT,
  }),
  larp_v15: (i, o) => ({
    cmd: 'python3',
    args: ['deob.py', i, '-o', o, '--obfuscator', 'luraph_v15'],
    cwd: path.join(ROOT, 'larp/Deobfuscator/deobf'),
  }),
  larp: (i, o) => ({
    cmd: 'python3',
    args: ['cli.py', i, '-o', o, '--trace-fallback'],
    cwd: path.join(ROOT, 'larp/Deobfuscator/deobf'),
  }),
  moonsec: (i, o) => ({
    cmd: 'node',
    args: ['index.js', i, '-o', o],
    cwd: path.join(ROOT, 'moonsec'),
  }),
};
const DEFAULT_ORDER = ['luraph', 'wearedevs', 'moonsec', 'larp_v15', 'larp'];

// Deteksi ringan di server untuk mode "auto" (menentukan urutan percobaan engine)
const HINTS = {
  luraph: [[/lura\.ph|Luraph\s+Obfuscator|\bLPH_\w+|["']LPH[~!]/i, 90]],
  wearedevs: [[/wearedevs/i, 90]],
  larp_v15: [[/LARP_?v?15|Larp\s*v?15/i, 90]],
  larp: [[/LARP_?v?14|\bLarp\b/i, 70]],
  moonsec: [[/moon_?sec/i, 90]],
};
function autoOrder(code) {
  const s = code.length > 1.5e6 ? code.slice(0, 1.5e6) : code;
  const scored = Object.entries(HINTS)
    .map(([k, list]) => [k, list.reduce((a, [re, w]) => a + (re.test(s) ? w : 0), 0)])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  return [...scored, ...DEFAULT_ORDER.filter((k) => !scored.includes(k))];
}

// ============================ HELPERS ============================
class JobError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const safeName = (n) => (path.basename(String(n || 'script.lua')).replace(/[^\w.\-]/g, '_').slice(0, 80) || 'script.lua');

function run(cmd, args, { cwd = ROOT, timeout = 60000, maxLog = 65536 } = {}) {
  return new Promise((resolve) => {
    let log = '';
    let settled = false;
    let timedOut = false;
    let p;
    try {
      p = spawn(cmd, args, { cwd, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ code: -1, log: String(e), timedOut: false });
    }
    const add = (d) => { if (log.length < maxLog) log += d.toString().slice(0, maxLog - log.length); };
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    const killGroup = () => {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* sudah mati */ } }
    };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, Math.max(1000, timeout));
    const done = (code, extra = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, log: log + extra, timedOut });
    };
    p.on('error', (e) => done(-1, String(e)));
    p.on('close', (code) => done(code));
  });
}

async function inspect(inPath, outPath) {
  let st;
  try { st = await fsp.stat(outPath); } catch { return { exists: false }; }
  if (!st.isFile() || st.size === 0) return { exists: false };
  const [a, b] = await Promise.all([fsp.readFile(inPath), fsp.readFile(outPath)]);
  const changed = sha(a) !== sha(b);
  let valid = null; // null = tidak diketahui
  if (AST_OK) {
    const r = await run(cfg.astBin, [outPath], { timeout: 20000, maxLog: 256 });
    valid = r.code === 0;
  }
  return { exists: true, size: st.size, changed, valid };
}

// Jalankan satu engine, opsional beberapa pass (output pass sebelumnya jadi input berikutnya)
async function attempt(jobId, engine, inPath, dir, mode, passes, deadline) {
  let cur = inPath;
  let best = null;
  for (let p = 1; p <= passes; p++) {
    const remain = deadline - Date.now();
    if (remain < 5000) { if (!best) best = { engine, error: 'timeout' }; break; }
    const out = path.join(dir, `${engine}_${p}.lua`);
    const spec = ENGINES[engine](cur, out, mode);
    const r = await run(spec.cmd, spec.args, { cwd: spec.cwd, timeout: remain });
    if (r.timedOut) { if (!best) best = { engine, error: 'timeout' }; break; }
    const info = await inspect(cur, out);
    if (!info.exists) {
      console.error(`[${jobId}] ${engine} pass ${p} gagal (exit ${r.code}): ${r.log.slice(-1500)}`);
      if (!best) best = { engine, error: r.code ? `exit ${r.code}` : 'output kosong' };
      break;
    }
    if (p > 1 && info.valid === false) break; // jangan timpa hasil bagus dengan pass yang rusak
    best = { engine, path: out, ...info, passes: p };
    if (!info.changed) break; // sudah stabil
    cur = out;
  }
  return best;
}

async function processJob({ jobId, code, engine, mode, passes }) {
  const key = sha(Buffer.concat([Buffer.from(`${engine}|${mode}|${passes}|`), code]));
  const cachedFile = path.join(CACHE, `${key}.lua`);
  const cachedMeta = path.join(CACHE, `${key}.json`);

  try {
    const meta = JSON.parse(await fsp.readFile(cachedMeta, 'utf8'));
    await fsp.access(cachedFile);
    const now = new Date();
    fsp.utimes(cachedFile, now, now).catch(() => {});
    fsp.utimes(cachedMeta, now, now).catch(() => {});
    return { file: cachedFile, meta: { ...meta, cache: true } };
  } catch { /* cache miss */ }

  const deadline = Date.now() + cfg.deadlineMs;
  const dir = await fsp.mkdtemp(path.join(WORK, 'job-'));
  try {
    const inPath = path.join(dir, 'in.lua');
    await fsp.writeFile(inPath, code);

    const order = engine === 'auto' ? autoOrder(code.toString('utf8')) : [engine];
    let winner = null;
    let fallback = null;
    let lastError = '';

    for (const eng of order) {
      if (Date.now() >= deadline - 5000) { lastError = lastError || 'timeout'; break; }
      const r = await attempt(jobId, eng, inPath, dir, mode, passes, deadline);
      if (!r) continue;
      if (!r.path) { lastError = r.error; continue; }
      if (engine !== 'auto') { winner = r; break; } // manual: terima apa adanya
      if (r.changed && r.valid !== false) { winner = r; break; }
      if (r.changed && !fallback) fallback = r; // berubah tapi sintaks tidak valid
    }

    const result = winner || fallback;
    if (!result) {
      const timeout = lastError === 'timeout';
      throw new JobError(
        timeout ? 504 : 422,
        engine === 'auto'
          ? `Tidak ada engine yang berhasil memproses script ini${timeout ? ' (waktu habis)' : ''}.`
          : `Engine ${engine} gagal memproses script (${lastError || 'tidak ada output'}). Coba engine lain atau pilih auto.`,
      );
    }

    const meta = {
      engine: result.engine,
      passes: result.passes,
      changed: result.changed,
      valid: result.valid,
      cache: false,
    };
    await fsp.copyFile(result.path, cachedFile);
    await fsp.writeFile(cachedMeta, JSON.stringify(meta));
    return { file: cachedFile, meta };
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ============================ SSRF GUARD ============================
function isPublicIp(addr) {
  let a;
  try { a = ipaddr.parse(addr); } catch { return false; }
  if (a.kind() === 'ipv6' && a.isIPv4MappedAddress()) a = a.toIPv4Address();
  return a.range() === 'unicast';
}

// Validasi alamat saat koneksi (mencegah DNS rebinding)
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return cb(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (!list.length || list.some((x) => !isPublicIp(x.address))) {
      return cb(new Error('Alamat tujuan tidak diizinkan'));
    }
    cb(null, address, family);
  });
}
const httpAgent = new http.Agent({ lookup: safeLookup });
const httpsAgent = new https.Agent({ lookup: safeLookup });

function assertUrlAllowed(u) {
  if (!/^https?:$/.test(u.protocol)) throw new JobError(400, 'URL harus http/https.');
  if (u.username || u.password) throw new JobError(400, 'URL dengan kredensial tidak diizinkan.');
  if (u.port && !['80', '443'].includes(u.port)) throw new JobError(400, 'Hanya port 80/443 yang diizinkan.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(local|localhost|internal)$/.test(host)) throw new JobError(400, 'Host tidak diizinkan.');
  if (ipaddr.isValid(host) && !isPublicIp(host)) throw new JobError(400, 'Alamat IP tidak diizinkan.');
}

async function fetchSafe(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new JobError(400, 'URL tidak valid.'); }
  for (let hop = 0; hop <= 3; hop++) {
    assertUrlAllowed(u);
    let r;
    try {
      r = await axios.get(u.href, {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxContentLength: cfg.maxBytes,
        maxBodyLength: cfg.maxBytes,
        maxRedirects: 0,
        httpAgent,
        httpsAgent,
        validateStatus: (s) => s >= 200 && s < 400,
      });
    } catch (e) {
      throw new JobError(502, `Gagal download URL: ${e.code || e.message}`);
    }
    if (r.status >= 300) {
      const loc = r.headers.location;
      if (!loc) throw new JobError(502, 'Redirect tanpa tujuan.');
      u = new URL(loc, u);
      continue;
    }
    return Buffer.from(r.data);
  }
  throw new JobError(502, 'Terlalu banyak redirect.');
}

// ============================ APP ============================
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: cfg.origins.includes('*') ? true : cfg.origins,
  exposedHeaders: ['Content-Disposition', 'X-Engine-Used', 'X-Passes', 'X-Changed', 'X-Syntax-Valid', 'X-Duration', 'X-Cache'],
}));
app.use(express.json({ limit: '100kb' }));
app.use('/api/', rateLimit({ windowMs: 60000, limit: cfg.rateLimit, standardHeaders: true, legacyHeaders: false, message: 'Terlalu banyak request, coba lagi sebentar.' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: cfg.maxBytes, files: 1 },
  fileFilter: (req, file, cb) => (/\.(lua|luau|txt)$/i.test(file.originalname) ? cb(null, true) : cb(new JobError(400, 'Hanya file .lua / .luau / .txt.'))),
});

const queue = new PQueue({ concurrency: cfg.concurrency });
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  if (e instanceof JobError) return res.status(e.status).send(e.message);
  const ref = crypto.randomBytes(3).toString('hex');
  console.error(`[${ref}]`, e);
  res.status(500).send(`Kesalahan internal (ref ${ref}).`);
});

function parseOptions(body = {}) {
  const engine = String(body.engine || 'luraph');
  if (engine !== 'auto' && !ENGINES[engine]) throw new JobError(400, 'Engine tidak dikenal.');
  const mode = body.mode === 'normal' ? 'normal' : 'flash';
  const passes = Math.min(3, Math.max(1, parseInt(body.passes, 10) || 1));
  return { engine, mode, passes };
}

async function handle(req, res, { code, name }) {
  if (code.length < 10) throw new JobError(400, 'Script terlalu pendek.');
  const opts = parseOptions(req.body);
  if (queue.size + queue.pending >= cfg.maxQueue + cfg.concurrency) {
    res.set('Retry-After', '15');
    throw new JobError(503, 'Server sedang sibuk, coba lagi sebentar lagi.');
  }

  const jobId = crypto.randomBytes(4).toString('hex');
  const t0 = Date.now();
  const { file, meta } = await queue.add(() => processJob({ jobId, code, ...opts }));
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(JSON.stringify({ job: jobId, req: opts.engine, used: meta.engine, mode: opts.mode, passes: meta.passes, changed: meta.changed, valid: meta.valid, cache: !!meta.cache, in: code.length, s: dur }));

  res.set({
    'X-Engine-Used': meta.engine,
    'X-Passes': String(meta.passes),
    'X-Changed': String(!!meta.changed),
    'X-Syntax-Valid': meta.valid === null || meta.valid === undefined ? 'unknown' : String(meta.valid),
    'X-Duration': dur,
    'X-Cache': meta.cache ? 'hit' : 'miss',
  });
  res.download(file, `deob_${meta.engine}_${safeName(name)}`, (err) => {
    if (err && !res.headersSent) res.status(500).end();
  });
}

app.get('/health', (req, res) => res.json({
  ok: true,
  ast: AST_OK,
  queue: { pending: queue.pending, waiting: queue.size },
}));

// Upload file / paste (frontend mengirim sebagai File)
app.post('/api/deobfuscate', (req, res, next) => {
  upload.single('luaFile')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof JobError) return res.status(err.status).send(err.message);
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).send(`File terlalu besar (maks ${cfg.maxBytes / 1048576} MB).`);
    return res.status(400).send('Upload gagal.');
  });
}, wrap(async (req, res) => {
  if (!req.file) throw new JobError(400, 'File tidak ditemukan.');
  await handle(req, res, { code: req.file.buffer, name: req.file.originalname });
}));

// Dari URL
app.post('/api/deobfuscate-url', wrap(async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') throw new JobError(400, 'URL kosong.');
  const code = await fetchSafe(url);
  await handle(req, res, { code, name: 'from_url.lua' });
}));

app.use((req, res) => res.status(404).send('Not found'));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(err.status || 500).send('Kesalahan internal.');
});

// ============================ CLEANUP ============================
async function sweep() {
  const now = Date.now();
  for (const [dir, ttl] of [[CACHE, cfg.cacheTtlMs], [WORK, 30 * 60000]]) {
    let names = [];
    try { names = await fsp.readdir(dir); } catch { continue; }
    for (const n of names) {
      const p = path.join(dir, n);
      try {
        const s = await fsp.stat(p);
        if (now - s.mtimeMs > ttl) await fsp.rm(p, { recursive: true, force: true });
      } catch { /* abaikan */ }
    }
  }
}
sweep();
setInterval(sweep, 10 * 60000).unref();

// ============================ START ============================
const server = app.listen(cfg.port, () => {
  console.log(`Server jalan di port ${cfg.port} | concurrency=${cfg.concurrency} | ast=${AST_OK}`);
});
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig} diterima, shutdown...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
