const http = require('http');
const os = require('os');
const path = require('path');
const fse = require('fs-extra');
const config = require('../config');
const settings = require('./settings');
const runtime = require('./runtime');
const atlas = require('./memory_atlas');
const memory = require('./memory');
const journal = require('./journal');

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
  return String(name || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_');
}

async function listNotesDetailed() {
  const files = await memory.listNotes();
  const out = [];
  for (const file of files.sort()) {
    const full = path.join(config.paths.notesDir, file);
    const stat = await fse.stat(full).catch(() => null);
    out.push({
      name: file,
      kind: file.startsWith('summary-') ? 'summary' : 'note',
      size: stat ? stat.size : 0,
      mtime: stat ? stat.mtime.toISOString() : null,
    });
  }
  return out;
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const chatId = firstOwnerChatId();

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

function appHtml() {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Galaxy S8 Agent</title>
<style>
:root{color-scheme:dark;--bg:#090d18;--panel:#10182b;--panel2:#151f38;--line:#2a3556;--text:#eef3ff;--muted:#91a1c4;--accent:#8fd3ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
#app{display:grid;grid-template-columns:240px minmax(0,1fr);height:100vh}.side{border-right:1px solid var(--line);background:var(--panel);padding:16px;overflow:auto}.main{display:grid;grid-template-rows:52px minmax(0,1fr);min-width:0}
h1{font-size:17px;margin:0 0 16px}.nav button{display:block;width:100%;text-align:left;background:transparent;color:var(--text);border:1px solid var(--line);border-radius:10px;padding:10px;margin:8px 0;cursor:pointer}.nav button:hover{border-color:var(--accent)}
.top{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding:0 16px;background:#0d1426}.content{padding:16px;overflow:auto}.grid{display:grid;grid-template-columns:280px minmax(0,1fr);gap:14px;height:100%}.card{background:var(--panel2);border:1px solid var(--line);border-radius:14px;padding:14px}.list{overflow:auto}.item{padding:9px;border-bottom:1px solid var(--line);cursor:pointer}.item:hover{background:#ffffff08}pre{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.muted{color:var(--muted)}iframe{width:100%;height:calc(100vh - 92px);border:1px solid var(--line);border-radius:14px;background:#050812}.journal{display:flex;flex-direction:column;gap:12px}.entry{border:1px solid var(--line);border-radius:12px;padding:12px;background:#0d1426}.entry.user{border-color:#345b7a}.entry.assistant{border-color:#4b5270}.entry-meta{display:flex;gap:8px;align-items:center;margin-bottom:8px;color:var(--muted);font-size:12px}.badge{border:1px solid var(--line);border-radius:999px;padding:2px 8px;background:#ffffff08;color:var(--text)}.entry-text{white-space:pre-wrap;color:var(--text);font-size:14px;line-height:1.5}
</style>
</head>
<body>
<div id="app"><aside class="side"><h1>Galaxy S8 Agent</h1><div class="nav">
<button onclick="showStatus()">Status</button>
<button onclick="showAtlas()">Memory Atlas</button>
<button onclick="showNotes('note')">Notes</button>
<button onclick="showNotes('summary')">Summaries</button>
<button onclick="showJournal()">Journal</button>
<button onclick="showSettings()">Settings</button>
</div><p class="muted">Read-only local UI. Keep this URL private.</p></aside><main class="main"><div class="top"><strong id="title">Status</strong><span class="muted" id="state"></span></div><div class="content" id="content"></div></main></div>
<script>
const token=new URL(location.href).searchParams.get('token')||'';
const api=(p)=>fetch(p+(p.includes('?')?'&':'?')+'token='+encodeURIComponent(token)).then(r=>{if(!r.ok)throw new Error(r.status+' '+r.statusText);return r.json()});
const title=t=>document.getElementById('title').textContent=t;
const content=html=>document.getElementById('content').innerHTML=html;
const esc=s=>String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const fmtTime=ts=>{try{return new Date(ts).toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'})}catch{return ts||''}};
const sourceLabel=s=>s==='assistant'?'white rabbit':'Ты';
const viaLabel=v=>({voice:'voice',audio:'audio',video_note:'video note',text:'text'}[v||'text']||v||'text');
const renderJournalEntry=e=>'<article class="entry '+esc(e.source||'user')+'"><div class="entry-meta"><span class="badge">'+esc(sourceLabel(e.source))+'</span><span>'+esc(fmtTime(e.ts))+'</span><span>'+esc(viaLabel(e.via))+'</span></div><div class="entry-text">'+esc(e.text)+'</div></article>';
async function showStatus(){title('Status');const s=await api('/api/status');content('<div class="card"><pre>'+esc(JSON.stringify(s,null,2))+'</pre></div>')}
async function showSettings(){title('Settings');const s=await api('/api/settings');content('<div class="card"><pre>'+esc(JSON.stringify(s,null,2))+'</pre></div>')}
async function showAtlas(){title('Memory Atlas');document.getElementById('state').textContent='building...';const a=await api('/api/atlas');document.getElementById('state').textContent=a.stats.notes+' files, '+a.stats.topics+' topics';content('<iframe src="/atlas.html?token='+encodeURIComponent(token)+'"></iframe>')}
async function showNotes(kind){title(kind==='summary'?'Summaries':'Notes');const n=await api('/api/notes');const list=n.notes.filter(x=>x.kind===kind);content('<div class="grid"><div class="card list">'+list.map(x=>'<div class="item" onclick="openNote(\\''+esc(x.name)+'\\')"><strong>'+esc(x.name)+'</strong><br><span class="muted">'+esc(x.mtime||'')+'</span></div>').join('')+'</div><div class="card"><pre id="viewer" class="muted">Select a file</pre></div></div>')}
async function openNote(name){const n=await api('/api/note?name='+encodeURIComponent(name));document.getElementById('viewer').textContent=n.content}
async function showJournal(){title('Journal');const j=await api('/api/journal');content('<div class="grid"><div class="card list">'+j.days.map(d=>'<div class="item" onclick="openJournal(\\''+esc(d)+'\\')">'+esc(d)+'</div>').join('')+'</div><div class="card"><div id="viewer" class="muted">Select a day</div></div></div>')}
async function openJournal(day){const j=await api('/api/journal?day='+encodeURIComponent(day));document.getElementById('viewer').className='journal';document.getElementById('viewer').innerHTML=j.entries.length?j.entries.map(renderJournalEntry).join(''):'<p class="muted">No entries for this day.</p>'}
showStatus().catch(e=>content('<pre>'+esc(e.message)+'</pre>'));
</script>
</body></html>`;
}

async function serveAtlasHtml(res) {
  if (!(await fse.pathExists(atlas.HTML_FILE))) {
    await atlas.buildAtlas({ chatId: firstOwnerChatId() });
  }
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
      if (url.pathname === '/') return html(res, appHtml());
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
