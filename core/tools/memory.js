const memory = require('../memory');

module.exports = {
  list_notes: {
    name: 'list_notes',
    description:
      "List the filenames of the agent's long-term notes (markdown files under memory/notes, including folders).",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const files = await memory.listNotes();
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
      if (content === null) return { found: false };
      return { found: true, name, content };
    },
  },

  write_note: {
    name: 'write_note',
    description:
      'Write or append to a long-term markdown note. Folder paths are allowed, e.g. "projects/psur_club.md". Use "append": true to add to an existing note instead of overwriting. You cannot target projects/_index.md (human-only routing file).',
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
      return { saved };
    },
  },
};
