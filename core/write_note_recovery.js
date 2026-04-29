'use strict';

/**
 * Извлечение и очистка JSON как у write_note в тексте модели (без вызова tool).
 * Нужна устойчивость к ``` внутри строк JSON и к нескольким блокам ```json.
 */

/** Сбалансированный JSON-объект от позиции `{` (учитывает строки и экранирование). */
function extractBalancedJsonObject(s, start) {
  if (start < 0 || start >= s.length || s[start] !== '{') return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (!inStr) {
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) return s.slice(start, i + 1);
      }
      continue;
    }
    if (esc) {
      esc = false;
      continue;
    }
    if (c === '\\') {
      esc = true;
      continue;
    }
    if (c === '"') inStr = false;
  }
  return null;
}

function looksLikeWriteNote(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name || !name.endsWith('.md')) return false;
  if (obj.content === undefined || obj.content === null) return false;
  return true;
}

/**
 * Ищет в тексте объект { name, content } как у write_note (json или «сырой» после ```json).
 */
function extractWriteNotePayload(text) {
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
      if (looksLikeWriteNote(parsed)) return parsed;
    } catch {
      /* next fence */
    }
  }
  const nameIdx = s.indexOf('"name"');
  if (nameIdx !== -1) {
    const braceAt = s.lastIndexOf('{', nameIdx);
    if (braceAt !== -1) {
      const jsonStr = extractBalancedJsonObject(s, braceAt);
      if (jsonStr) {
        try {
          const parsed = JSON.parse(jsonStr);
          if (looksLikeWriteNote(parsed)) return parsed;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return null;
}

/** Удаляет из ответа блоки ```json … ``` с write_note полезной нагрузкой (чтобы не слать в Telegram). */
function stripWriteNoteJsonFences(text) {
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
      if (!looksLikeWriteNote(parsed)) break;
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
  extractBalancedJsonObject,
  extractWriteNotePayload,
  stripWriteNoteJsonFences,
  looksLikeWriteNote,
};
