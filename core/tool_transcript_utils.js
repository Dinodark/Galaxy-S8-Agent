const path = require('path');
const fse = require('fs-extra');

/** Paths the tool handler returned as `saved` (deduped). */
function collectWrittenNotesReported(transcript) {
  const out = [];
  const seen = new Set();
  for (const row of transcript || []) {
    if (row.tool !== 'write_note' || !row.result || !row.result.ok) continue;
    const saved = row.result.result && row.result.result.saved;
    if (!saved || seen.has(saved)) continue;
    seen.add(saved);
    out.push(saved);
  }
  return out;
}

function countToolsInTranscript(transcript) {
  const c = { list_notes: 0, read_note: 0, write_note: 0 };
  for (const row of transcript || []) {
    const t = row.tool;
    if (t === 'list_notes' || t === 'read_note' || t === 'write_note') {
      c[t] += 1;
    }
  }
  return c;
}

/**
 * После прогона — проверить, что каждый успешный write_note действительно дал файл на диске.
 */
async function verifyWrittenNotesOnDisk(transcript, notesRoot) {
  let verifiedRows = 0;
  const missing = [];
  const verifiedPathsDedup = [];
  const seenPath = new Set();

  for (const row of transcript || []) {
    if (row.tool !== 'write_note' || !row.result || !row.result.ok) continue;
    const saved = row.result.result && row.result.result.saved;
    if (!saved) continue;
    const full = path.join(notesRoot, saved);
    try {
      const st = await fse.stat(full);
      if (st.isFile()) {
        verifiedRows += 1;
        if (!seenPath.has(saved)) {
          seenPath.add(saved);
          verifiedPathsDedup.push(saved);
        }
      } else {
        missing.push(saved);
      }
    } catch {
      missing.push(saved);
    }
  }

  const uniqueMissing = [...new Set(missing)];
  return {
    verifiedRows,
    writtenNotes: verifiedPathsDedup.sort(),
    writtenNotesMissing: uniqueMissing.length ? uniqueMissing : undefined,
  };
}

/**
 * Компактная строка для лога / UI — без содержимого note (только длина для write_note).
 */
function summarizeMemoryToolStep(row, index) {
  const step = index + 1;
  const tool = row.tool;
  const args = row.args || {};
  const res = row.result || {};
  const ok = res.ok === true;

  if (tool === 'list_notes') {
    const n =
      ok && res.result && Array.isArray(res.result.files)
        ? res.result.files.length
        : null;
    return { step, tool, ok, fileCount: n };
  }
  if (tool === 'read_note') {
    const name = typeof args.name === 'string' ? args.name : '';
    const found = !!(ok && res.result && res.result.found);
    return { step, tool, ok, name, found };
  }
  if (tool === 'write_note') {
    const name = typeof args.name === 'string' ? args.name : '';
    const append = args.append !== false;
    const contentChars =
      typeof args.content === 'string' ? args.content.length : 0;
    const saved =
      ok && res.result && res.result.saved ? res.result.saved : undefined;
    const error = ok ? undefined : res.error || 'failed';
    return {
      step,
      tool,
      ok,
      name,
      append,
      contentChars,
      saved,
      error,
    };
  }
  return { step, tool, ok, error: res.error };
}

module.exports = {
  collectWrittenNotesReported,
  countToolsInTranscript,
  verifyWrittenNotesOnDisk,
  summarizeMemoryToolStep,
};
