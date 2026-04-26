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
const reminders = require('./reminders');

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

function collectLanCandidates() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const [name, entries] of Object.entries(nets)) {
    for (const n of entries || []) {
      if (n.family !== 'IPv4' || n.internal) continue;
      const ip = n.address;
      let score = 0;
      if (/^192\.168\./.test(ip)) score += 40;
      else if (/^10\./.test(ip)) score += 35;
      else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) score += 30;
      else if (/^169\.254\./.test(ip)) score -= 50;
      if (/wlan|wi-?fi|eth|en|rmnet/i.test(name)) score += 8;
      if (/tailscale|tun|tap|wg|utun|ppp|vpn/i.test(name)) score -= 20;
      candidates.push({ ip, score, iface: name });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * @param {number} [max]
 * @returns {{ ip: string, score: number, iface: string }[]}
 */
function localIpCandidates(max = 5) {
  const all = collectLanCandidates();
  const seen = new Set();
  const out = [];
  for (const c of all) {
    if (seen.has(c.ip)) continue;
    seen.add(c.ip);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

function localIp() {
  const top = localIpCandidates(1);
  return top[0] ? top[0].ip : null;
}

async function authorize(req, url, s) {
  const token = s.web && s.web.token;
  if (!token) return false;
  const got = url.searchParams.get('token') || req.headers['x-agent-token'];
  return got === token;
}

function isPathUnderDir(filePath, rootDir) {
  const rel = path.relative(path.resolve(rootDir), path.resolve(filePath));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function readJsonBody(req, maxBytes = 512_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (ch) => {
      size += ch.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(ch);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw.trim()) {
          resolve(null);
          return;
        }
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
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
    const name = memory.sanitizeName(url.searchParams.get('name'));
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

  if (pathname === '/api/reminders') {
    const tz =
      (await settings.get('dailyReview.tz').catch(() => '')) ||
      reminders.systemTz();
    if (!chatId) return json(res, 200, { count: 0, tz, reminders: [] });
    const items = await reminders.listPending({ chatId });
    const out = items.map((r) => ({
      id: r.id,
      text: r.text,
      fire_at: r.fireAt,
      recurrence: r.recurrence || null,
      until: r.until || null,
      max_count: r.maxCount == null ? null : r.maxCount,
      fired_count: r.firedCount || 0,
      created_at: r.createdAt || null,
    }));
    return json(res, 200, { count: out.length, tz, reminders: out });
  }

  if (pathname === '/api/notes/save' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return json(res, 400, { error: e && e.message ? e.message : 'invalid body' });
    }
    if (!body || typeof body.name !== 'string' || typeof body.content !== 'string') {
      return json(res, 400, { error: 'expected JSON { name, content }' });
    }
    const safe = memory.sanitizeName(body.name);
    if (!safe) return json(res, 400, { error: 'invalid name' });
    const full = path.join(config.paths.notesDir, safe);
    if (!isPathUnderDir(full, config.paths.notesDir)) {
      return json(res, 400, { error: 'path must stay under memory/notes' });
    }
    await fse.ensureDir(path.dirname(full));
    await fse.writeFile(full, body.content, 'utf8');
    const stat = await fse.stat(full);
    try {
      await atlas.buildAtlas({ chatId });
    } catch (e) {
      console.warn('[web] atlas rebuild after save failed:', e.message);
    }
    return json(res, 200, {
      ok: true,
      name: safe,
      mtime: stat.mtime.toISOString(),
      size: stat.size,
    });
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

  try {
    const { ensureKnowledgeTree } = require('./bootstrap_knowledge');
    const k = await ensureKnowledgeTree();
    if (k.createdIndex) {
      console.log(`[web] created knowledge core: ${k.path}`);
    }
  } catch (e) {
    console.warn('[web] knowledge bootstrap failed:', e.message);
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

module.exports = { startServer, localIp, localIpCandidates };

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[web] failed:', err.message);
    process.exit(1);
  });
}
