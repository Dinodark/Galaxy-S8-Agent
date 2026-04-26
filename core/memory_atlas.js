const path = require('path');
const fse = require('fs-extra');
const config = require('../config');

const INDEX_FILE = path.join(config.paths.memoryDir, 'memory_index.json');
const HTML_FILE = path.join(config.paths.memoryDir, 'atlas.html');
const ATLAS_VERSION = 'knowledge-map-v2';
const FOLDER_COLORS = [
  '#9cbf8f',
  '#d8c16f',
  '#8fb7d6',
  '#d49ab5',
  '#b6a0d4',
  '#d69f7e',
  '#8fc8bd',
  '#c9a66b',
];

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
  const files = [];

  async function walk(dir, prefix = '') {
    const entries = await fse.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(rel);
      }
    }
  }

  await walk(config.paths.notesDir);
  files.sort();
  const out = [];
  for (const file of files) {
    const base = path.basename(file);
    if (base.startsWith('summary-')) continue;
    const full = path.join(config.paths.notesDir, file);
    const content = await fse.readFile(full, 'utf8');
    const stat = await fse.stat(full);
    const folder = file.includes('/') ? file.split('/')[0] : 'root';
    out.push({
      file,
      label: base.replace(/\.md$/, ''),
      folder,
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

function buildGraph(notes) {
  const folders = [...new Set(notes.map((n) => n.folder))].sort();
  const folderColors = Object.fromEntries(
    folders.map((folder, index) => [folder, FOLDER_COLORS[index % FOLDER_COLORS.length]])
  );
  const nodes = notes.map((n) => ({
    id: nodeId('note', n.file),
    label: n.label,
    type: 'note',
    file: n.file,
    folder: n.folder,
    color: folderColors[n.folder],
    content: n.content,
    excerpt: n.excerpt,
    headings: n.headings,
    keywords: n.keywords,
    size: n.size,
    mtime: n.mtime,
  }));

  const linkCandidates = [];
  for (let i = 0; i < notes.length; i += 1) {
    const a = notes[i];
    const aWords = new Set(a.keywords.slice(0, 10).map((k) => k.word));
    for (let j = i + 1; j < notes.length; j += 1) {
      const b = notes[j];
      const shared = b.keywords.slice(0, 10).map((k) => k.word).filter((word) => aWords.has(word));
      if (shared.length > 0) {
        linkCandidates.push({
          source: nodeId('note', a.file),
          target: nodeId('note', b.file),
          label: shared.slice(0, 3).join(', '),
          score: shared.length,
        });
      }
    }
  }

  const links = linkCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(notes.length * 4, 12))
    .map(({ score, ...link }) => link);

  return { nodes, links, folders: folders.map((name) => ({ name, color: folderColors[name] })) };
}

function renderHtml(index) {
  const data = JSON.stringify(index).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vatoko Galaxy Memory Atlas</title>
<style>
:root{color-scheme:dark;--bg:#111111;--panel:#171717;--panel-soft:#1d1d1d;--panel-hover:#242424;--muted:#9a9a9a;--text:#f1f1f1;--line:transparent;--accent:#d6d6d6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--text);overflow:hidden}
header{height:58px;display:flex;align-items:center;gap:16px;padding:0 18px;background:var(--bg)}
h1{font-size:17px;margin:0}header span{color:var(--muted)}#wrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,38vw);height:calc(100vh - 58px)}#graphWrap{position:relative;background:var(--bg)}#graph{width:100%;height:100%}#side{background:var(--panel-soft);padding:18px;overflow:auto}
.legend{position:absolute;left:14px;top:14px;max-width:280px;padding:10px 12px;border-radius:14px;background:var(--panel);box-shadow:0 12px 40px #0003}.legend strong{display:block;margin-bottom:6px}.legendItem{display:flex;align-items:center;gap:8px;color:var(--muted);margin:5px 0}.dot{width:10px;height:10px;border-radius:50%;display:inline-block}
.pill{display:inline-block;border-radius:999px;padding:3px 8px;margin:2px;color:var(--muted);background:var(--panel-hover)}.node{cursor:pointer}.node circle{stroke:#fff3;stroke-width:1.5}.node.active circle{stroke:var(--text);stroke-width:2.5}.node text{fill:var(--text);font-size:12px;text-shadow:0 1px 8px #000}.link{stroke:#ffffff20;stroke-width:1}.hint{color:var(--muted)}.empty{max-width:520px;margin:10vh auto;color:var(--muted);font-size:18px}
h2{margin:0 0 8px;font-size:18px}h3{margin:18px 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}pre{white-space:pre-wrap;font-family:inherit;color:var(--text);line-height:1.6}.filePath{color:var(--muted);word-break:break-all}.readerHead{position:sticky;top:0;margin:-18px -18px 16px;padding:18px;background:var(--panel-soft)}
@media(max-width:900px){#wrap{grid-template-columns:1fr;grid-template-rows:minmax(55vh,1fr) minmax(280px,45vh)}.legend{position:static;margin:12px}.readerHead{position:static}}
</style>
</head>
<body>
<header><h1>Memory Atlas</h1><span>${escHtml(index.version)} · ${escHtml(index.generatedAt)} · ${index.stats.notes} knowledge files · ${index.stats.folders} folders · ${index.stats.links} links</span></header>
<div id="wrap"><main id="graphWrap"><div class="legend" id="legend"></div><svg id="graph" role="img" aria-label="Knowledge graph"></svg></main><aside id="side"><h2>Выбери файл</h2><p class="hint">Слева база знаний: каждая точка — markdown-файл из memory/notes. Цвет показывает папку.</p></aside></div>
<script>
(function applyTheme(){
const p=new URLSearchParams(location.search);
const map={theme_bg:'--bg',theme_surface:'--panel',theme_surfaceSoft:'--panel-soft',theme_surfaceHover:'--panel-hover',theme_text:'--text',theme_muted:'--muted',theme_accent:'--accent',theme_line:'--line'};
for(const [param,cssVar] of Object.entries(map)){const value=p.get(param);if(value)document.documentElement.style.setProperty(cssVar,value)}
})();
const ATLAS=${data};
const svg=document.getElementById('graph'),side=document.getElementById('side'),legend=document.getElementById('legend'),W=()=>svg.clientWidth,H=()=>svg.clientHeight;
let activeId='';
let nodes=ATLAS.graph.nodes.map((n,i)=>({...n,x:W()/2+Math.cos(i*2.399)*220+Math.random()*120,y:H()/2+Math.sin(i*2.399)*220+Math.random()*120,vx:0,vy:0}));
let links=ATLAS.graph.links.map(l=>({source:nodes.find(n=>n.id===l.source),target:nodes.find(n=>n.id===l.target),label:l.label})).filter(l=>l.source&&l.target);
if(!nodes.length){svg.outerHTML='<div class="empty">Пока нет файлов базы знаний. Создай markdown в memory/notes, например projects/white_rabbit_spec.md.</div>'}
renderLegend();
function size(n){return Math.max(10,Math.min(22,10+Math.sqrt(Math.max(n.size,1))/18))}
function tick(){const w=W(),h=H();for(const n of nodes){n.vx+=(w/2-n.x)*0.00035;n.vy+=(h/2-n.y)*0.00035}
for(const l of links){const dx=l.target.x-l.source.x,dy=l.target.y-l.source.y,d=Math.hypot(dx,dy)||1,force=(d-190)*0.00055;l.source.vx+=dx/d*force;l.source.vy+=dy/d*force;l.target.vx-=dx/d*force;l.target.vy-=dy/d*force}
for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,min=92;if(d<min){const f=(min-d)*0.018;a.vx-=dx/d*f;a.vy-=dy/d*f;b.vx+=dx/d*f;b.vy+=dy/d*f}}
for(const n of nodes){n.vx*=0.84;n.vy*=0.84;n.x=Math.max(36,Math.min(w-36,n.x+n.vx));n.y=Math.max(36,Math.min(h-36,n.y+n.vy))}draw();requestAnimationFrame(tick)}
function draw(){svg.innerHTML='';for(const l of links){const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('class','link');line.setAttribute('x1',l.source.x);line.setAttribute('y1',l.source.y);line.setAttribute('x2',l.target.x);line.setAttribute('y2',l.target.y);svg.appendChild(line)}
for(const n of nodes){const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('class','node'+(n.id===activeId?' active':''));g.setAttribute('transform',\`translate(\${n.x},\${n.y})\`);g.onmousedown=e=>drag(e,n);g.onclick=()=>show(n);const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('r',size(n));c.setAttribute('fill',n.color||'#fff');g.appendChild(c);const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.setAttribute('x',size(n)+4);t.setAttribute('y',4);t.textContent=n.label.slice(0,32);g.appendChild(t);svg.appendChild(g)}}
function show(n){activeId=n.id;draw();side.innerHTML=\`<div class="readerHead"><h2>\${escapeHtml(n.label)}</h2><div class="filePath">\${escapeHtml(n.file)}</div><p class="hint">Папка: \${escapeHtml(n.folder)} · \${Math.round((n.size||0)/1024*10)/10} KB</p></div><h3>Ключевые темы</h3>\${(n.keywords||[]).slice(0,10).map(k=>\`<span class="pill">\${escapeHtml(k.word||k)}</span>\`).join('')||'<p class="hint">Нет</p>'}<h3>Текст файла</h3><pre>\${escapeHtml(n.content||'')}</pre>\`}
function renderLegend(){legend.innerHTML='<strong>Папки</strong>'+((ATLAS.graph.folders||[]).map(f=>\`<div class="legendItem"><span class="dot" style="background:\${escapeHtml(f.color)}"></span><span>\${escapeHtml(f.name)}</span></div>\`).join('')||'<div class="hint">Пока нет папок</div>')}
function escapeHtml(s){return String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function drag(e,n){e.preventDefault();const move=ev=>{const r=svg.getBoundingClientRect();n.x=ev.clientX-r.left;n.y=ev.clientY-r.top;draw()};const up=()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up)};window.addEventListener('mousemove',move);window.addEventListener('mouseup',up)}
tick();</script>
</body></html>`;
}

async function buildAtlas({ chatId } = {}) {
  const notes = await readNotes();
  const graph = buildGraph(notes);
  const index = {
    version: ATLAS_VERSION,
    generatedAt: new Date().toISOString(),
    stats: {
      notes: notes.length,
      folders: graph.folders.length,
      links: graph.links.length,
    },
    notes: notes.map(({ content, ...n }) => n),
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
