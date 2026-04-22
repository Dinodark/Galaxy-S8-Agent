const path = require('path');
const fse = require('fs-extra');

const MAX_READ_BYTES = 200_000;

function resolveSafe(p) {
  const abs = path.resolve(p);
  return abs;
}

module.exports = {
  read_file: {
    name: 'read_file',
    description:
      'Read a text file from the host filesystem. Returns up to ~200KB of content.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    handler: async ({ path: p }) => {
      const abs = resolveSafe(p);
      if (!(await fse.pathExists(abs))) return { found: false };
      const stat = await fse.stat(abs);
      if (stat.isDirectory()) return { found: false, reason: 'is a directory' };
      const content = await fse.readFile(abs, 'utf8');
      const truncated = content.length > MAX_READ_BYTES;
      return {
        found: true,
        path: abs,
        size: stat.size,
        truncated,
        content: truncated ? content.slice(0, MAX_READ_BYTES) : content,
      };
    },
  },

  write_file: {
    name: 'write_file',
    description:
      'Write text content to a file. Creates parent dirs as needed. Overwrites by default.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        append: { type: 'boolean', default: false },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    handler: async ({ path: p, content, append = false }) => {
      const abs = resolveSafe(p);
      await fse.ensureDir(path.dirname(abs));
      if (append) await fse.appendFile(abs, content);
      else await fse.writeFile(abs, content);
      return { ok: true, path: abs };
    },
  },

  list_dir: {
    name: 'list_dir',
    description: 'List entries in a directory.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    handler: async ({ path: p }) => {
      const abs = resolveSafe(p);
      if (!(await fse.pathExists(abs))) return { found: false };
      const entries = await fse.readdir(abs, { withFileTypes: true });
      return {
        found: true,
        path: abs,
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file',
        })),
      };
    },
  },
};
