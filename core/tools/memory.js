const memory = require('../memory');

function debugLog(hypothesisId, location, message, data) {
  if (typeof fetch !== 'function') return;
  fetch('http://127.0.0.1:7933/ingest/05d097ed-198e-47e6-8b77-1f7ddf4809a1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '047796',
    },
    body: JSON.stringify({
      sessionId: '047796',
      runId: 'pre-fix',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}

module.exports = {
  list_notes: {
    name: 'list_notes',
    description:
      "List the filenames of the agent's long-term notes (markdown files under memory/notes, including folders).",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const files = await memory.listNotes();
      // #region agent log
      debugLog('H2', 'core/tools/memory.js:list_notes', 'list_notes result', {
        fileCount: files.length,
        files: files.slice(0, 50),
      });
      // #endregion
      return { files };
    },
  },

  read_note: {
    name: 'read_note',
    description: 'Read a long-term note by filename or folder path (e.g. "ideas.md" or "projects/psur_club.md").',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
    handler: async ({ name }) => {
      const content = await memory.readNote(name);
      // #region agent log
      debugLog('H2,H3', 'core/tools/memory.js:read_note', 'read_note result', {
        name,
        found: content !== null,
        contentLength: content ? content.length : 0,
      });
      // #endregion
      if (content === null) return { found: false };
      return { found: true, name, content };
    },
  },

  write_note: {
    name: 'write_note',
    description:
      'Write or append to a long-term markdown note. Folder paths are allowed, e.g. "projects/psur_club.md". Use "append": true to add to an existing note instead of overwriting.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Note filename or folder path, e.g. "ideas.md" or "projects/psur_club.md"' },
        content: { type: 'string' },
        append: { type: 'boolean', default: true },
      },
      required: ['name', 'content'],
      additionalProperties: false,
    },
    handler: async ({ name, content, append = true }) => {
      const saved = await memory.writeNote(name, content, { append });
      // #region agent log
      debugLog('H3', 'core/tools/memory.js:write_note', 'write_note result', {
        requestedName: name,
        saved,
        append,
        contentLength: String(content || '').length,
      });
      // #endregion
      return { saved };
    },
  },
};
