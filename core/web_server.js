const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const fse = require('fs-extra');
const config = require('../config');
const settings = require('./settings');
const runtime = require('./runtime');
const atlas = require('./memory_atlas');
const memory = require('./memory');
const journal = require('./journal');

const UPDATE_LOG_FILE = path.join(config.paths.tmpDir, 'update-restart.log');
const UPDATE_PID_FILE = path.join(config.paths.tmpDir, 'update-restart.pid');
const UPDATE_SCRIPT = path.join(__dirname, '..', 'scripts', 'update_restart.sh');
const WEB_DIST_DIR = path.join(__dirname, '..', 'web', 'dist');

function json(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function html(res, body) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function text(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function firstOwnerChatId() {
  return config.telegram.allowedUserIds[0] || null;
}

function localIp() {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const n of entries || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return null;
}

async function authorize(req, url, s) {
  const token = s.web && s.web.token;
  if (!token) return false;
  const got = url.searchParams.get('token') || req.headers['x-agent-token'];
  return got === token;
}

function sanitizeName(name) {
  return String(name || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9._-]+/g, '_'))
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

async function isUpdateRunning() {
  if (!(await fse.pathExists(UPDATE_PID_FILE))) return false;
  const raw = await fse.readFile(UPDATE_PID_FILE, 'utf8').catch(() => '');
  const pid = Number(String(raw).trim());
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    await fse.remove(UPDATE_PID_FILE).catch(() => {});
    return false;
  }
}

async function readUpdateLog() {
  if (!(await fse.pathExists(UPDATE_LOG_FILE))) {
    return { exists: false, running: await isUpdateRunning(), content: '' };
  }
  const stat = await fse.stat(UPDATE_LOG_FILE);
  const content = await fse.readFile(UPDATE_LOG_FILE, 'utf8');
  return {
    exists: true,
    running: await isUpdateRunning(),
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    content: content.slice(-12000),
  };
}

async function startUpdateRestart() {
  if (await isUpdateRunning()) {
    return { ok: false, started: false, reason: 'update already running' };
  }
  await fse.ensureDir(config.paths.tmpDir);
  await fse.writeFile(
    UPDATE_LOG_FILE,
    `${new Date().toISOString()} Update/restart requested from web UI.\n`
  );

  const child = spawn('sh', [UPDATE_SCRIPT], {
    cwd: path.join(__dirname, '..'),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      GALAXY_AGENT_SESSION: process.env.GALAXY_AGENT_SESSION || 'galaxy-agent',
      GALAXY_AGENT_WEB_SESSION:
        process.env.GALAXY_AGENT_WEB_SESSION || 'galaxy-agent-web',
      GALAXY_AGENT_UPDATE_LOG: UPDATE_LOG_FILE,
      GALAXY_AGENT_UPDATE_PID: UPDATE_PID_FILE,
    },
  });
  child.unref();
  return { ok: true, started: true, pid: child.pid, logFile: UPDATE_LOG_FILE };
}

async function listNotesDetailed() {
  const files = await memory.listNotes();
  const out = [];
  for (const file of files.sort()) {
    const full = path.join(config.paths.notesDir, file);
    const stat = await fse.stat(full).catch(() => null);
    const base = path.basename(file);
    out.push({
      name: file,
      kind: base.startsWith('summary-') ? 'summary' : 'note',
      size: stat ? stat.size : 0,
      mtime: stat ? stat.mtime.toISOString() : null,
    });
  }
  return out;
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const chatId = firstOwnerChatId();

  if (pathname === '/api/actions/update-log') {
    return json(res, 200, await readUpdateLog());
  }

  if (pathname === '/api/actions/update-restart') {
    if (req.method !== 'POST') {
      return json(res, 405, { error: 'method not allowed' });
    }
    return json(res, 200, await startUpdateRestart());
  }

  if (pathname === '/api/status') {
    return json(res, 200, await runtime.buildStatus(chatId));
  }

  if (pathname === '/api/settings') {
    return json(res, 200, await settings.getPublicSettings());
  }

  if (pathname === '/api/atlas') {
    const result = await atlas.buildAtlas({ chatId });
    return json(res, 200, result.index);
  }

  if (pathname === '/api/notes') {
    return json(res, 200, { notes: await listNotesDetailed() });
  }

  if (pathname === '/api/note') {
    const name = sanitizeName(url.searchParams.get('name'));
    if (!name) return json(res, 400, { error: 'missing name' });
    const content = await memory.readNote(name);
    if (content == null) return json(res, 404, { error: 'not found' });
    return json(res, 200, { name, content });
  }

  if (pathname === '/api/journal') {
    if (!chatId) return json(res, 200, { days: [], entries: [] });
    const day = url.searchParams.get('day');
    if (day) {
      return json(res, 200, { day, entries: await journal.readDay(chatId, day) });
    }
    return json(res, 200, { days: await journal.listDays(chatId) });
  }

  return json(res, 404, { error: 'not found' });
}

async function serveWebApp(res, token) {
  const file = path.join(WEB_DIST_DIR, 'index.html');
  if (!(await fse.pathExists(file))) {
    return text(res, 503, 'Dashboard build missing. Pull latest web/dist assets or build on a dev machine with npm run web:build.');
  }
  const raw = await fse.readFile(file, 'utf8');
  const tokenParam = `token=${encodeURIComponent(token || '')}`;
  return html(
    res,
    raw
      .replaceAll('src="/assets/', `src="/assets/?${tokenParam}&file=`)
      .replaceAll('href="/assets/', `href="/assets/?${tokenParam}&file=`)
  );
}

async function serveWebAsset(res, pathname) {
  const name = path.basename(pathname);
  if (!name || name.includes('..')) {
    return text(res, 404, 'Not found');
  }
  const file = path.join(WEB_DIST_DIR, 'assets', name);
  if (!(await fse.pathExists(file))) return text(res, 404, 'Not found');
  res.writeHead(200, {
    'Content-Type': contentType(file),
    'Cache-Control': 'no-store',
  });
  return fse.createReadStream(file).pipe(res);
}

async function serveAtlasHtml(res) {
  await atlas.buildAtlas({ chatId: firstOwnerChatId() });
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  fse.createReadStream(atlas.HTML_FILE).pipe(res);
}

async function startServer() {
  const s = await settings.getSettings();
  const host = s.web.host || '0.0.0.0';
  const port = s.web.port || 8787;
  if (!s.web.enabled) {
    console.log('[web] disabled in settings');
    return null;
  }
  if (!s.web.token) {
    throw new Error('web token is missing');
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (!(await authorize(req, url, s))) {
        return text(res, 401, 'Unauthorized');
      }
      if (url.pathname === '/') return serveWebApp(res, s.web.token);
      if (url.pathname === '/assets/') {
        return serveWebAsset(res, url.searchParams.get('file') || '');
      }
      if (url.pathname === '/atlas.html') return serveAtlasHtml(res);
      if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
      return text(res, 404, 'Not found');
    } catch (err) {
      console.error('[web] request error:', err);
      return json(res, 500, { error: err.message });
    }
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const ip = localIp() || 'PHONE_IP';
  console.log(`[web] listening on http://${ip}:${port}/?token=${s.web.token}`);
  return server;
}

module.exports = { startServer, localIp };

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[web] failed:', err.message);
    process.exit(1);
  });
}
