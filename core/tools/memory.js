const memory = require('../memory');

module.exports = {
  list_notes: {
    name: 'list_notes',
    description:
      "List the filenames of the agent's long-term notes (markdown files in memory/notes).",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const files = await memory.listNotes();
      return { files };
    },
  },

  read_note: {
    name: 'read_note',
    description: 'Read a long-term note by filename (e.g. "ideas.md").',
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
      'Write or append to a long-term markdown note. Use "append": true to add to an existing note instead of overwriting.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Note filename, e.g. "ideas.md"' },
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
