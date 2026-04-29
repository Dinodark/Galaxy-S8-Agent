'use strict';

const { extractBalancedJsonObject, looksLikeWriteNote } = require('./write_note_recovery');

let cachedToolNames = null;
function validToolNames() {
  if (!cachedToolNames) {
    cachedToolNames = new Set(Object.keys(require('./tools').registry));
  }
  return cachedToolNames;
}

/**
 * Псевдо-вызов инструмента в тексте модели вместо native tool_calls:
 * `{"call":"list_notes","arguments":{}}` и похожее.
 */
function parseToolInvocation(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (looksLikeWriteNote(obj)) return null;

  const names = validToolNames();
  let toolName = null;
  if (typeof obj.call === 'string' && names.has(obj.call)) {
    toolName = obj.call;
  } else if (typeof obj.function === 'string' && names.has(obj.function)) {
    toolName = obj.function;
  } else if (typeof obj.name === 'string' && names.has(obj.name) && !obj.name.endsWith('.md')) {
    toolName = obj.name;
  }
  if (!toolName) return null;

  let args = obj.arguments !== undefined ? obj.arguments : obj.args;
  if (args === undefined || args === null) args = {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) args = {};

  return { name: toolName, args };
}

/**
 * Первый распознанный псевдо-вызов в тексте (после ```json или «сырой» `{`).
 */
function extractPrintedToolCall(text) {
  const s = String(text || '');
  const fenceStarts = [...s.matchAll(/```(?:json)?\s*/gi)];
  for (const m of fenceStarts) {
    const afterFence = m.index + m[0].length;
    const braceAt = s.indexOf('{', afterFence);
    if (braceAt === -1) continue;
    const jsonStr = extractBalancedJsonObject(s, braceAt);
    if (!jsonStr) continue;
    try {
      const parsed = JSON.parse(jsonStr);
      const inv = parseToolInvocation(parsed);
      if (inv) return inv;
    } catch {
      /* next */
    }
  }
  let idx = 0;
  while (idx < s.length) {
    const braceAt = s.indexOf('{', idx);
    if (braceAt === -1) break;
    const jsonStr = extractBalancedJsonObject(s, braceAt);
    if (!jsonStr) {
      idx = braceAt + 1;
      continue;
    }
    try {
      const parsed = JSON.parse(jsonStr);
      const inv = parseToolInvocation(parsed);
      if (inv) return inv;
    } catch {
      /* continue */
    }
    idx = braceAt + 1;
  }
  return null;
}

/** Убирает из ответа блоки ```json … ``` с псевдо-tool JSON (не write_note). */
function stripPrintedToolInvocations(text) {
  let s = String(text || '');
  let guard = 0;
  while (guard++ < 24) {
    const m = /```(?:json)?\s*/i.exec(s);
    if (!m) break;
    const braceAt = s.indexOf('{', m.index + m[0].length);
    if (braceAt === -1) break;
    const jsonStr = extractBalancedJsonObject(s, braceAt);
    if (!jsonStr) break;
    try {
      const parsed = JSON.parse(jsonStr);
      const inv = parseToolInvocation(parsed);
      if (!inv) break;
    } catch {
      break;
    }
    const closeFence = s.indexOf('```', braceAt + jsonStr.length);
    const cutEnd = closeFence !== -1 ? closeFence + 3 : braceAt + jsonStr.length;
    s = (s.slice(0, m.index) + s.slice(cutEnd)).trim();
  }
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = {
  extractPrintedToolCall,
  stripPrintedToolInvocations,
  parseToolInvocation,
};
