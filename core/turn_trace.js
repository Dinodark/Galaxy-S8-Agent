'use strict';

const path = require('path');
const crypto = require('crypto');
const fse = require('fs-extra');
const config = require('../config');

function localDateStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function traceFilePath() {
  return path.join(config.paths.logsDir, `turn-trace-${localDateStamp()}.jsonl`);
}

function isTurnTraceEnabled() {
  const t = config.agent && config.agent.turnTrace;
  if (t && typeof t.enabled === 'boolean') return t.enabled;
  return true;
}

/**
 * Compact tool rows for JSONL (no full tool payloads / note bodies).
 * @param {Array<{ tool?: string, result?: object, [k: string]: unknown }>} transcript
 */
function summarizeToolTranscript(transcript) {
  return (transcript || []).map((t) => {
    const row = { tool: String((t && t.tool) || '') };
    const res = t && t.result;
    row.ok = !!(res && res.ok);
    if (row.tool === 'write_note' && res && res.ok && res.result && res.result.saved) {
      row.saved = res.result.saved;
    }
    if (res && !res.ok && res.error) row.err = String(res.error).slice(0, 240);
    if (t.fallback) row.fallback = true;
    if (t.recovered || t.recoveredFromJson || t.recoveredFromText) row.recovered = true;
    if (t.preloaded) row.preloaded = true;
    if (t.grounded) row.grounded = true;
    return row;
  });
}

function safeRouteSnapshot(routeResult) {
  if (!routeResult || routeResult.skipped) return { skipped: true };
  return {
    ok: !!routeResult.ok,
    intent: routeResult.intent != null ? String(routeResult.intent) : undefined,
    confidence:
      typeof routeResult.confidence === 'number' && !Number.isNaN(routeResult.confidence)
        ? routeResult.confidence
        : undefined,
    error: routeResult.error ? String(routeResult.error).slice(0, 200) : undefined,
  };
}

/**
 * @param {object} payload
 * @param {string|number} payload.chatId
 * @param {string} payload.via
 * @param {number} payload.userLen
 * @param {string} [payload.userSha256]
 * @param {boolean} payload.writeIntent
 * @param {boolean} payload.knowledgeDiscussion
 * @param {object} [payload.intentMerge]
 * @param {object} payload.router
 * @param {string} payload.exit
 * @param {number} payload.steps
 * @param {ReturnType<summarizeToolTranscript>} payload.tools
 * @param {number} payload.replyLen
 */
async function appendTurnTrace(payload) {
  if (!isTurnTraceEnabled()) return;
  try {
    await fse.ensureDir(config.paths.logsDir);
    const line = JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n';
    await fse.appendFile(traceFilePath(), line, 'utf8');
  } catch (e) {
    console.warn('[turn_trace] append failed:', e && e.message ? e.message : e);
  }
}

function userMessageSha256(userMessage) {
  return crypto.createHash('sha256').update(String(userMessage || ''), 'utf8').digest('hex');
}

module.exports = {
  appendTurnTrace,
  summarizeToolTranscript,
  safeRouteSnapshot,
  userMessageSha256,
  traceFilePath,
};
