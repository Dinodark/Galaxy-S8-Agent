'use strict';

const crypto = require('crypto');
const path = require('path');
const fse = require('fs-extra');
const config = require('../config');
const settings = require('./settings');

/** Под `logs/` (gitignore), рядом с turn-trace. */
const SUBDIR = 'llm-debug';

function storeDir() {
  return path.join(config.paths.logsDir, SUBDIR);
}

function posixRel() {
  return path.posix.join('logs', SUBDIR);
}

function previewFromMessages(messages) {
  const u = (messages || []).find((m) => m && m.role === 'user');
  let t = '';
  if (u && typeof u.content === 'string') t = u.content;
  else if (u && Array.isArray(u.content)) {
    t = u.content
      .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
      .join(' ')
      .trim();
  }
  const line = String(t).replace(/\s+/g, ' ').trim();
  return line ? line.slice(0, 140) : '(нет текста user)';
}

/**
 * @param {unknown[]} messages
 * @param {number} maxPerMsg
 */
function cloneMessagesForLog(messages, maxPerMsg = 100_000) {
  return (messages || []).map((m) => {
    if (!m || typeof m !== 'object') return m;
    const o = { role: m.role };
    if (m.name) o.name = m.name;
    if (m.tool_call_id) o.tool_call_id = m.tool_call_id;
    if (m.tool_calls) o.tool_calls = m.tool_calls;
    const c = m.content;
    if (typeof c === 'string') {
      o.content =
        c.length > maxPerMsg ? `${c.slice(0, maxPerMsg)}\n…[truncated ${c.length - maxPerMsg} chars]` : c;
    } else if (Array.isArray(c)) {
      o.content = c;
    } else if (c != null) {
      o.content = String(c).slice(0, maxPerMsg);
    }
    return o;
  });
}

function shrinkOpenRouterResponse(data) {
  if (!data || typeof data !== 'object') return data;
  const raw = JSON.stringify(data);
  if (raw.length <= 350_000) return data;
  try {
    const copy = JSON.parse(raw);
    const ch = copy.choices && copy.choices[0];
    if (ch && ch.message && typeof ch.message.content === 'string' && ch.message.content.length > 80_000) {
      const c = ch.message.content;
      ch.message.content = `${c.slice(0, 80_000)}\n…[truncated assistant content ${c.length}]`;
    }
    return { ...copy, _truncatedForLog: true };
  } catch {
    return { _truncatedForLog: true, note: 'response too large to store' };
  }
}

async function getLimits() {
  const s = await settings.getSettings();
  const d = (s && s.debugLlm) || {};
  return {
    enabled: !!d.enabled,
    maxMb: Math.min(Math.max(Number(d.maxMb) || 20, 1), 500),
    maxFiles: Math.min(Math.max(Number(d.maxFiles) || 80, 5), 2000),
  };
}

async function enforceQuota(maxMb, maxFiles) {
  const d = storeDir();
  if (!(await fse.pathExists(d))) return;
  const names = (await fse.readdir(d)).filter((f) => f.endsWith('.json'));
  const rows = await Promise.all(
    names.map(async (n) => {
      const fp = path.join(d, n);
      const st = await fse.stat(fp);
      return { fp, mtime: st.mtimeMs, size: st.size };
    })
  );
  let total = rows.reduce((s, x) => s + x.size, 0);
  const maxBytes = Math.max(1, maxMb) * 1024 * 1024;
  rows.sort((a, b) => a.mtime - b.mtime);
  let i = 0;
  while (rows.length > maxFiles || total > maxBytes) {
    const victim = rows[i++];
    if (!victim) break;
    await fse.remove(victim.fp).catch(() => {});
    total -= victim.size;
    rows.splice(rows.indexOf(victim), 1);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.scope
 * @param {number|null} [opts.chatId]
 * @param {string|null} [opts.turnId]
 * @param {string|null} [opts.triageBatchId]
 * @param {string|null} [opts.today]
 * @param {unknown[]} opts.messages
 * @param {object} opts.requestBody
 * @param {object|null} [opts.openrouterResponse]
 * @param {string|null} [opts.errorText]
 */
async function writeRecord(opts) {
  const limits = await getLimits();
  if (!limits.enabled) return null;

  const id = crypto.randomUUID();
  const ts = new Date().toISOString();
  const payload = {
    id,
    ts,
    scope: String(opts.scope || 'unknown'),
    chatId: opts.chatId == null ? null : opts.chatId,
    turnId: opts.turnId || null,
    triageBatchId: opts.triageBatchId || null,
    today: opts.today || null,
    preview: previewFromMessages(opts.messages),
    model: opts.requestBody && opts.requestBody.model,
    error: opts.errorText || null,
    request: {
      model: opts.requestBody && opts.requestBody.model,
      messages: cloneMessagesForLog(opts.messages),
      tools: opts.requestBody && opts.requestBody.tools,
      tool_choice: opts.requestBody && opts.requestBody.tool_choice,
      temperature: opts.requestBody && opts.requestBody.temperature,
      response_format: opts.requestBody && opts.requestBody.response_format,
    },
    response: opts.errorText ? null : shrinkOpenRouterResponse(opts.openrouterResponse),
  };

  const dir = storeDir();
  await fse.ensureDir(dir);
  const fp = path.join(dir, `${id}.json`);
  const raw = JSON.stringify(payload, null, 2);
  await fse.writeFile(fp, raw, 'utf8');
  await enforceQuota(limits.maxMb, limits.maxFiles);
  return id;
}

async function maybeRecordSuccess({ debugContext, messages, requestBody, responseData }) {
  if (!debugContext || !debugContext.scope) return null;
  try {
    return await writeRecord({
      scope: debugContext.scope,
      chatId: debugContext.chatId != null ? debugContext.chatId : null,
      turnId: debugContext.turnId || null,
      triageBatchId: debugContext.triageBatchId || null,
      today: debugContext.today || null,
      messages,
      requestBody,
      openrouterResponse: responseData,
      errorText: null,
    });
  } catch (e) {
    console.warn('[llm-debug] record success failed:', e && e.message ? e.message : e);
    return null;
  }
}

async function maybeRecordError({ debugContext, messages, requestBody, err, effectiveModel }) {
  if (!debugContext || !debugContext.scope) return null;
  try {
    const body = { ...requestBody, model: effectiveModel || (requestBody && requestBody.model) };
    let errText = err && err.message ? String(err.message) : String(err);
    if (err && err.response && err.response.data) {
      try {
        errText += ' | ' + JSON.stringify(err.response.data).slice(0, 4000);
      } catch {
        /* ignore */
      }
    }
    return await writeRecord({
      scope: debugContext.scope,
      chatId: debugContext.chatId != null ? debugContext.chatId : null,
      turnId: debugContext.turnId || null,
      triageBatchId: debugContext.triageBatchId || null,
      today: debugContext.today || null,
      messages,
      requestBody: body,
      openrouterResponse: null,
      errorText: errText.slice(0, 20_000),
    });
  } catch (e) {
    console.warn('[llm-debug] record error failed:', e && e.message ? e.message : e);
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSafeId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

async function listEntries(limit = 50) {
  const d = storeDir();
  if (!(await fse.pathExists(d))) {
    return { dir: posixRel(), totalBytes: 0, fileCount: 0, entries: [] };
  }
  const names = (await fse.readdir(d)).filter((f) => f.endsWith('.json'));
  const rows = await Promise.all(
    names.map(async (n) => {
      const fp = path.join(d, n);
      const st = await fse.stat(fp);
      const id = n.replace(/\.json$/i, '');
      return { fp, id, mtime: st.mtimeMs, size: st.size };
    })
  );
  const totalBytes = rows.reduce((s, x) => s + x.size, 0);
  rows.sort((a, b) => b.mtime - a.mtime);
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const slice = rows.slice(0, cap);
  const entries = await Promise.all(
    slice.map(async ({ id, fp, size, mtime }) => {
      try {
        const raw = await fse.readFile(fp, 'utf8');
        const j = JSON.parse(raw);
        return {
          id: j.id || id,
          ts: j.ts,
          scope: j.scope,
          preview: j.preview,
          sizeBytes: size,
          chatId: j.chatId,
          turnId: j.turnId,
          triageBatchId: j.triageBatchId,
          today: j.today,
          model: j.model,
          error: j.error || null,
          mtimeIso: new Date(mtime).toISOString(),
        };
      } catch {
        return {
          id,
          ts: null,
          scope: 'error',
          preview: '(не удалось прочитать)',
          sizeBytes: size,
          error: 'parse',
          mtimeIso: new Date(mtime).toISOString(),
        };
      }
    })
  );
  return { dir: posixRel(), totalBytes, fileCount: names.length, entries };
}

async function readEntry(id) {
  if (!isSafeId(id)) return null;
  const fp = path.join(storeDir(), `${id}.json`);
  if (!(await fse.pathExists(fp))) return null;
  try {
    return await fse.readJson(fp);
  } catch {
    return null;
  }
}

async function clearAll() {
  const d = storeDir();
  if (!(await fse.pathExists(d))) return { removed: 0 };
  const names = (await fse.readdir(d)).filter((f) => f.endsWith('.json'));
  for (const n of names) {
    await fse.remove(path.join(d, n)).catch(() => {});
  }
  return { removed: names.length };
}

module.exports = {
  storeDir,
  posixRel,
  maybeRecordSuccess,
  maybeRecordError,
  listEntries,
  readEntry,
  clearAll,
  isSafeId,
  getLimits,
};
