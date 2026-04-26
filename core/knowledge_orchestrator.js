const path = require('path');
const fse = require('fs-extra');
const config = require('../config');

/** Позиционный путь (posix) — защищён от записи агентом; правите только вы. */
const CORE_KNOWLEDGE_RELPATH = 'projects/_index.md';
/** Путь внутри memory/notes для fs (кросс-платформа). */
const INDEX_REL = path.join('projects', '_index.md');
const TEMPLATE = path.join(__dirname, 'templates', 'knowledge', 'projects_index.md');

const DEFAULT_INDEX_BODY = [
  '# Маршруты знаний',
  '# Формат: путь/к/файлу.md | ключ1, ключ2, домен.ru',
  '# Файл создаётся при первом маршрутизируемом сохранении; отредактируй вручную в Termux/ПК.',
  '',
].join('\n');

/**
 * @typedef {Object} RouteScore
 * @property {string} path
 * @property {number} score
 */

/**
 * @typedef {Object} OrchestrationPlan
 * @property {'update_existing_project'|'cross_project_link'|'new_project_candidate'|'uncertain'} intent
 * @property {'low'|'medium'|'high'} confidence
 * @property {string|null} systemMessage
 * @property {string} fallbackName
 * @property {string[]} topPaths
 * @property {Record<string, number>} scores
 */

function normalizeRelPosix(s) {
  return String(s || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

/**
 * @param {string} safeRel результат sanitizeName: только запись "projects/…" .
 */
function isKnowledgeCoreIndexPath(safeRel) {
  return normalizeRelPosix(safeRel) === CORE_KNOWLEDGE_RELPATH;
}

/**
 * @param {string} absPath абсолютный путь в ФС
 */
function isKnowledgeCoreIndexAbs(absPath) {
  try {
    const core = path.resolve(path.join(config.paths.notesDir, ...CORE_KNOWLEDGE_RELPATH.split('/')));
    return path.resolve(String(absPath || '')) === core;
  } catch {
    return false;
  }
}

function normalizePathRel(p) {
  let s = String(p || '')
    .trim()
    .replace(/\\/g, '/');
  if (s.startsWith('memory/notes/')) s = s.slice('memory/notes/'.length);
  s = s.replace(/^\//, '');
  if (s.includes('..')) return '';
  if (!s.endsWith('.md')) s += '.md';
  return s;
}

/**
 * @param {string} content
 * @returns {Map<string, Set<string>>}
 */
function parseIndexContent(content) {
  const byPath = new Map();
  const lines = String(content || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    if (!t.includes('|')) continue;
    const [left, right] = t.split('|');
    const p = normalizePathRel(left);
    if (!p || p === CORE_KNOWLEDGE_RELPATH) continue;
    const kws = String(right || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!byPath.has(p)) byPath.set(p, new Set());
    for (const k of kws) byPath.get(p).add(k);
  }
  return byPath;
}

/**
 * @param {Map<string, Set<string>>} byPath
 * @param {string[]} listFiles
 */
function addBasenameKeywordsFromDisk(byPath, listFiles) {
  for (const f of listFiles) {
    if (path.basename(f).startsWith('summary-')) continue;
    if (normalizeRelPosix(f) === CORE_KNOWLEDGE_RELPATH) continue;
    if (!f.startsWith('projects/') || !f.endsWith('.md')) continue;
    if (f.endsWith('/_index.md') || f.endsWith('projects/_index.md')) continue;
    const base = f.replace(/^projects\//, '').replace(/\.md$/, '');
    if (base === '_index') continue;
    if (!byPath.has(f)) byPath.set(f, new Set());
    const set = byPath.get(f);
    set.add(base.toLowerCase());
    set.add(base.toLowerCase().replace(/_/g, ' '));
  }
}

/**
 * @param {string} text
 * @param {Map<string, Set<string>>} byPath
 * @returns {Record<string, number>}
 */
function scoreMessage(text, byPath) {
  const norm = String(text || '').toLowerCase();
  const scores = {};
  for (const [p, kws] of byPath) {
    let s = 0;
    for (const kw of kws) {
      if (kw.length < 2) continue;
      if (norm.includes(kw)) {
        const w = kw.includes('.') || kw.length >= 6 ? 2.5 : kw.length >= 4 ? 2 : 1;
        s += w;
      }
    }
    scores[p] = s;
  }
  return scores;
}

function topTwo(scores) {
  return Object.entries(scores)
    .map(([path, score]) => ({ path, score }))
    .sort((a, b) => b.score - a.score)
    .filter((e) => e.score > 0);
}

/**
 * @param {string} userMessage
 * @param {string[]} listFiles
 * @param {string} [indexContent]
 * @returns {OrchestrationPlan}
 */
function planWriteOrchestration(userMessage, listFiles, indexContent) {
  const text = String(userMessage || '');
  const safeFiles = (listFiles || [])
    .map(String)
    .filter(Boolean)
    .filter((f) => !path.basename(f).startsWith('summary-'));
  const byPath = parseIndexContent(indexContent);
  addBasenameKeywordsFromDisk(byPath, safeFiles);
  byPath.delete(CORE_KNOWLEDGE_RELPATH);
  const scores = scoreMessage(text, byPath);
  const ranked = topTwo(scores);
  const top = ranked[0] || { path: null, score: 0 };
  const second = ranked[1] || { path: null, score: 0 };

  let intent;
  if (top.score < 0.1) {
    if (/\bнов(ый|ая|ое)\s+проект|новый\s+сайт|еще\s+проект|еще\s+домен|домен\s+[\w.-]+\.\w+/.test(text)) {
      intent = 'new_project_candidate';
    } else {
      intent = 'uncertain';
    }
  } else if (second.path && second.score > 0) {
    const diff = top.score - second.score;
    const rel = top.score > 0 ? diff / top.score : 0;
    if (diff < 1 || rel < 0.4) {
      intent = 'cross_project_link';
    } else {
      intent = 'update_existing_project';
    }
  } else {
    intent = 'update_existing_project';
  }

  let confidence;
  if (intent === 'cross_project_link') {
    confidence = 'low';
  } else if (top.score >= 2.5 && (top.score - second.score) >= 1.5) {
    confidence = 'high';
  } else if (top.score >= 1) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  const topPaths = ranked.slice(0, 3).map((e) => e.path);

  let fallbackName = 'inbox.md';
  if (intent === 'update_existing_project' && top.path) {
    if (confidence === 'high') {
      fallbackName = top.path;
    } else if (confidence === 'medium' && second.score < 0.1) {
      fallbackName = top.path;
    }
  }

  const systemMessage = buildSystemMessage({
    userMessage: text,
    intent,
    confidence,
    ranked,
    scores,
    safeFiles,
    fallbackName,
  });

  return {
    intent,
    confidence,
    systemMessage,
    fallbackName,
    topPaths,
    scores,
  };
}

function buildSystemMessage({
  intent,
  confidence,
  ranked,
  safeFiles,
  fallbackName,
}) {
  const lines = [
    '## Knowledge orchestrator (one turn)',
    'The user has explicit write/save intent. You must call `write_note` (append) to integrate their message.',
    'Ground truth for which files exist — only paths from list_notes. Do not claim files that are not there unless you just created them with write_note.',
    '',
    `- **intent** (routed from keywords + index): \`${intent}\``,
    `- **confidence** (match strength): \`${confidence}\``,
  ];

  if (ranked.length > 0) {
    const table = ranked
      .slice(0, 5)
      .map((e) => `  - \`${e.path}\` (score ${e.score.toFixed(1)})`)
      .join('\n');
    lines.push(
      '',
      '**Top project matches (by index + file names):**',
      table
    );
  } else {
    lines.push(
      '',
      '**No keyword match** to indexed routes or `projects/*.md` basenames. Prefer `inbox.md` with a short title line and `tags: #needs_routing` in the first line of the block.'
    );
  }

  lines.push(
    '',
    '**Knowledge core (read-only for you, the model):** never call `write_note` or any file tool on `projects/_index.md`. That file is the human-only routing table; the user edits it to steer routing.',
    '',
    '**Hybrid routing rules:**',
    '- **High confidence, single lead (`update_existing_project`)**: `write_note` append to that path; reply in 1–2 short sentences: what you saved and where.',
    '- **Cross-link or low confidence** (`cross_project_link`, `uncertain`): `write_note` append to `inbox.md`, mention 2 real candidate files from the match list in plain language (not invented paths), or say you need a project name if nothing matches.',
    '- **If two projects scored close**: you may add one line to `inbox_conflicts.md` (append) describing the ambiguity, then still save the substance to `inbox.md` unless the user names one project clearly.',
    '',
    '**If automatic fallback is needed** the runtime will use: `' + fallbackName + '`.',
    '',
    '**Real note files (for reference, truncated to 15):**',
    safeFiles.length
      ? safeFiles
          .slice(0, 15)
          .map((f) => `- \`${f}\``)
          .join('\n')
      : '- (no markdown files yet besides summaries)'
  );

  return lines.join('\n');
}

async function loadProjectsIndex() {
  const full = path.join(config.paths.notesDir, INDEX_REL);
  if (await fse.pathExists(full)) {
    return fse.readFile(full, 'utf8');
  }
  if (await fse.pathExists(TEMPLATE)) {
    return fse.readFile(TEMPLATE, 'utf8');
  }
  return DEFAULT_INDEX_BODY;
}

/**
 * @param {boolean} [ensureOnDisk]
 */
async function ensureProjectsIndexFile(ensureOnDisk = false) {
  const full = path.join(config.paths.notesDir, INDEX_REL);
  if (await fse.pathExists(full)) {
    return fse.readFile(full, 'utf8');
  }
  const body = (await fse.pathExists(TEMPLATE))
    ? await fse.readFile(TEMPLATE, 'utf8')
    : DEFAULT_INDEX_BODY;
  if (ensureOnDisk) {
    await fse.ensureDir(path.dirname(full));
    await fse.writeFile(full, body, 'utf8');
  }
  return body;
}

module.exports = {
  planWriteOrchestration,
  loadProjectsIndex,
  ensureProjectsIndexFile,
  parseIndexContent,
  scoreMessage,
  normalizePathRel,
  isKnowledgeCoreIndexPath,
  isKnowledgeCoreIndexAbs,
  CORE_KNOWLEDGE_RELPATH,
  INDEX_REL,
};
