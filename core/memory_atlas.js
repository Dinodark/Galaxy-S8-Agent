const path = require('path');
const fse = require('fs-extra');
const config = require('../config');
const journal = require('./journal');

const INDEX_FILE = path.join(config.paths.memoryDir, 'memory_index.json');
const HTML_FILE = path.join(config.paths.memoryDir, 'atlas.html');

const STOPWORDS = new Set(
  [
    'что', 'как', 'это', 'или', 'для', 'тебя', 'меня', 'мне', 'все', 'ещё',
    'если', 'уже', 'надо', 'нужно', 'можно', 'будет', 'чтобы', 'когда',
    'this', 'that', 'with', 'from', 'have', 'will', 'would', 'there', 'their',
    'about', 'into', 'your', 'you', 'and', 'the', 'for', 'are', 'not',
  ]
);

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeWord(w) {
  return String(w || '').toLowerCase().replace(/^[_-]+|[_-]+$/g, '');
}

function words(text) {
  return (String(text || '').match(/[a-zа-яё0-9][a-zа-яё0-9_-]{3,}/giu) || [])
    .map(normalizeWord)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function topKeywords(text, max = 10) {
  const counts = new Map();
  for (const w of words(text)) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([word, count]) => ({ word, count }));
}

function headings(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.match(/^(#{1,3})\s+(.+)$/))
    .filter(Boolean)
    .slice(0, 8)
    .map((m) => m[2].trim());
}

function excerpt(text, max = 240) {
  const plain = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

function nodeId(type, id) {
  return `${type}:${id}`.replace(/[^a-zA-Zа-яА-ЯёЁ0-9:_-]+/g, '_');
}

async function readNotes() {
  await fse.ensureDir(config.paths.notesDir);
  const files = (await fse.readdir(config.paths.notesDir))
    .filter((f) => f.endsWith('.md'))
    .sort();
  const out = [];
  for (const file of files) {
    const full = path.join(config.paths.notesDir, file);
    const content = await fse.readFile(full, 'utf8');
    const stat = await fse.stat(full);
    out.push({
      file,
      kind: file.startsWith('summary-') ? 'summary' : 'note',
      content,
      size: content.length,
      mtime: stat.mtime.toISOString(),
      headings: headings(content),
      keywords: topKeywords(content, 12),
      excerpt: excerpt(content),
    });
  }
  return out;
}

async function readRecentJournal(chatId, days = 3) {
  if (!chatId) return [];
  const available = await journal.listDays(chatId);
  const selected = available.slice(-days);
  const out = [];
  for (const day of selected) {
    const entries = await journal.readDay(chatId, day);
    const text = entries.map((e) => e.text).join('\n');
    out.push({
      day,
      entries: entries.length,
      keywords: topKeywords(text, 8),
      excerpt: excerpt(text, 220),
    });
  }
  return out;
}

function buildGraph(notes) {
  const nodes = [];
  const links = [];
  const topicToFiles = new Map();

  for (const n of notes) {
    nodes.push({
      id: nodeId(n.kind, n.file),
      label: n.file.replace(/\.md$/, ''),
      type: n.kind,
      file: n.file,
      excerpt: n.excerpt,
      headings: n.headings,
      keywords: n.keywords,
      size: n.size,
      mtime: n.mtime,
    });
    for (const kw of n.keywords.slice(0, 8)) {
      if (!topicToFiles.has(kw.word)) topicToFiles.set(kw.word, []);
      topicToFiles.get(kw.word).push(n.file);
    }
  }

  for (const [topic, refs] of topicToFiles.entries()) {
    if (refs.length < 2 && nodes.length > 6) continue;
    const topicId = nodeId('topic', topic);
    nodes.push({
      id: topicId,
      label: topic,
      type: 'topic',
      file: '',
      excerpt: `Связывает ${refs.length} файлов`,
      headings: [],
      keywords: [],
      size: refs.length,
      mtime: '',
    });
    for (const ref of refs.slice(0, 12)) {
      const target = nodeId(ref.startsWith('summary-') ? 'summary' : 'note', ref);
      links.push({ source: topicId, target, label: topic });
    }
  }

  return { nodes, links };
}

function renderHtml(index) {
  const data = JSON.stringify(index).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Galaxy S8 Agent Memory Atlas</title>
<style>
:root{color-scheme:dark;--bg:#111111;--panel:#171717;--panel-soft:#1d1d1d;--panel-hover:#242424;--muted:#9a9a9a;--text:#f1f1f1;--line:transparent;--accent:#d6d6d6;--topic:#d8c16f;--note:#9cbf8f;--summary:#b6a0d4;--journal:#c98f9b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--text);overflow:hidden}
header{height:58px;display:flex;align-items:center;gap:16px;padding:0 18px;background:var(--bg)}
h1{font-size:17px;margin:0}header span{color:var(--muted)}#wrap{display:grid;grid-template-columns:260px minmax(0,1fr) 330px;height:calc(100vh - 58px)}#graph{width:100%;height:100%}#side,#journals{background:var(--panel-soft);padding:18px;overflow:auto}#journals{background:var(--panel)}
.journalItem{padding:10px;border-radius:12px;margin:8px 0;background:var(--panel-hover)}.journalItem strong{display:block}.journalItem small{color:var(--muted)}
.pill{display:inline-block;border-radius:999px;padding:3px 8px;margin:2px;color:var(--muted);background:var(--panel-hover)}.node{cursor:pointer}.node circle{stroke:#fff2;stroke-width:1.5}.node text{fill:var(--text);font-size:12px;text-shadow:0 1px 8px #000}.link{stroke:#ffffff20;stroke-width:1}.hint{color:var(--muted)}.empty{max-width:520px;margin:10vh auto;color:var(--muted);font-size:18px}
h2{margin:0 0 8px;font-size:18px}h3{margin:18px 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}pre{white-space:pre-wrap;font-family:inherit;color:var(--muted)}
</style>
</head>
<body>
<header><h1>Memory Atlas</h1><span>${escHtml(index.generatedAt)} · ${index.stats.notes} files · ${index.stats.journalDays} journal days · ${index.stats.topics} topics · ${index.stats.links} links</span></header>
<div id="wrap"><aside id="journals"><h2>Журналы</h2><p class="hint">Последние дни отдельно от графа.</p></aside><svg id="graph" role="img" aria-label="Memory graph"></svg><aside id="side"><h2>Выбери файл</h2><p class="hint">На графе только файлы заметок, summary и темы. Узлы можно перетаскивать.</p></aside></div>
<script>
(function applyTheme(){
const p=new URLSearchParams(location.search);
const map={theme_bg:'--bg',theme_surface:'--panel',theme_surfaceSoft:'--panel-soft',theme_surfaceHover:'--panel-hover',theme_text:'--text',theme_muted:'--muted',theme_accent:'--accent',theme_line:'--line'};
for(const [param,cssVar] of Object.entries(map)){const value=p.get(param);if(value)document.documentElement.style.setProperty(cssVar,value)}
})();
const ATLAS=${data};
const svg=document.getElementById('graph'),side=document.getElementById('side'),journals=document.getElementById('journals'),W=()=>svg.clientWidth,H=()=>svg.clientHeight;
const colors={topic:'var(--topic)',note:'var(--note)',summary:'var(--summary)',journal:'var(--journal)'};
let nodes=ATLAS.graph.nodes.map((n,i)=>({...n,x:W()/2+Math.cos(i*2.399)*220+Math.random()*140,y:H()/2+Math.sin(i*2.399)*220+Math.random()*140,vx:0,vy:0}));
let links=ATLAS.graph.links.map(l=>({source:nodes.find(n=>n.id===l.source),target:nodes.find(n=>n.id===l.target),label:l.label})).filter(l=>l.source&&l.target);
if(!nodes.length){svg.outerHTML='<div class="empty">Пока нет заметок. Надиктуй мысли, дождись вечерней сводки или создай markdown в memory/notes.</div>'}
renderJournals();
function size(n){return n.type==='topic'?10+Math.min(n.size,12):n.type==='summary'?13:11}
function tick(){const w=W(),h=H();for(const n of nodes){n.vx+=(w/2-n.x)*0.00035;n.vy+=(h/2-n.y)*0.00035}
for(const l of links){const dx=l.target.x-l.source.x,dy=l.target.y-l.source.y,d=Math.hypot(dx,dy)||1,force=(d-210)*0.00055;l.source.vx+=dx/d*force;l.source.vy+=dy/d*force;l.target.vx-=dx/d*force;l.target.vy-=dy/d*force}
for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,min=92;if(d<min){const f=(min-d)*0.018;a.vx-=dx/d*f;a.vy-=dy/d*f;b.vx+=dx/d*f;b.vy+=dy/d*f}}
for(const n of nodes){n.vx*=0.84;n.vy*=0.84;n.x=Math.max(36,Math.min(w-36,n.x+n.vx));n.y=Math.max(36,Math.min(h-36,n.y+n.vy))}draw();requestAnimationFrame(tick)}
function draw(){svg.innerHTML='';for(const l of links){const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('class','link');line.setAttribute('x1',l.source.x);line.setAttribute('y1',l.source.y);line.setAttribute('x2',l.target.x);line.setAttribute('y2',l.target.y);svg.appendChild(line)}
for(const n of nodes){const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('class','node');g.setAttribute('transform',\`translate(\${n.x},\${n.y})\`);g.onmousedown=e=>drag(e,n);g.onclick=()=>show(n);const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('r',size(n));c.setAttribute('fill',colors[n.type]||'#fff');g.appendChild(c);const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.setAttribute('x',size(n)+4);t.setAttribute('y',4);t.textContent=n.label.slice(0,28);g.appendChild(t);svg.appendChild(g)}}
function show(n){side.innerHTML=\`<h2>\${escapeHtml(n.label)}</h2><p class="hint">\${escapeHtml(n.type)} \${n.file?('· '+escapeHtml(n.file)):''}</p><pre>\${escapeHtml(n.excerpt||'')}</pre><h3>Ключевые темы</h3>\${(n.keywords||[]).map(k=>\`<span class="pill">\${escapeHtml(k.word||k)}</span>\`).join('')||'<p class="hint">Нет</p>'}<h3>Заголовки</h3>\${(n.headings||[]).map(h=>\`<div>• \${escapeHtml(h)}</div>\`).join('')||'<p class="hint">Нет</p>'}\`}
function renderJournals(){journals.innerHTML='<h2>Журналы</h2><p class="hint">Последние дни отдельно от графа.</p>'+((ATLAS.journalDays||[]).map(d=>\`<div class="journalItem"><strong>\${escapeHtml(d.day)}</strong><small>\${d.entries} entries</small><p>\${escapeHtml(d.excerpt||'')}</p>\${(d.keywords||[]).slice(0,5).map(k=>\`<span class="pill">\${escapeHtml(k.word||k)}</span>\`).join('')}</div>\`).join('')||'<p class="hint">Пока нет journal-записей.</p>')}
function escapeHtml(s){return String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function drag(e,n){e.preventDefault();const move=ev=>{const r=svg.getBoundingClientRect();n.x=ev.clientX-r.left;n.y=ev.clientY-r.top;draw()};const up=()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up)};window.addEventListener('mousemove',move);window.addEventListener('mouseup',up)}
tick();</script>
</body></html>`;
}

async function buildAtlas({ chatId } = {}) {
  const notes = await readNotes();
  const journalDays = await readRecentJournal(chatId, 3);
  const graph = buildGraph(notes);
  const index = {
    generatedAt: new Date().toISOString(),
    stats: {
      notes: notes.length,
      journalDays: journalDays.length,
      topics: graph.nodes.filter((n) => n.type === 'topic').length,
      links: graph.links.length,
    },
    notes: notes.map(({ content, ...n }) => n),
    journalDays,
    graph,
  };
  await fse.ensureDir(config.paths.memoryDir);
  await fse.writeJson(INDEX_FILE, index, { spaces: 2 });
  await fse.writeFile(HTML_FILE, renderHtml(index));
  return { index, indexFile: INDEX_FILE, htmlFile: HTML_FILE };
}

async function status() {
  if (!(await fse.pathExists(INDEX_FILE))) {
    return { exists: false };
  }
  const index = await fse.readJson(INDEX_FILE);
  return {
    exists: true,
    generatedAt: index.generatedAt,
    stats: index.stats,
    htmlFile: HTML_FILE,
    indexFile: INDEX_FILE,
  };
}

module.exports = { buildAtlas, status, INDEX_FILE, HTML_FILE };
