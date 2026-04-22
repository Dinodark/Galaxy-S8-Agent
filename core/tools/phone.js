const { exec } = require('child_process');

function run(cmd, { timeoutMs = 10_000, input } = {}) {
  return new Promise((resolve) => {
    const child = exec(
      cmd,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          code: error && error.code != null ? error.code : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: error ? error.message : null,
        });
      }
    );
    if (input != null) {
      try {
        child.stdin.write(input);
        child.stdin.end();
      } catch {
        // ignore
      }
    }
  });
}

async function hasTermux() {
  const res = await run('command -v termux-battery-status');
  return res.code === 0 && res.stdout.trim().length > 0;
}

function parseJsonSafe(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function ensureTermux() {
  const ok = await hasTermux();
  if (!ok) {
    const err = new Error(
      'termux-api not available on this host. Install in Termux: `pkg install termux-api` and the Termux:API app.'
    );
    err.code = 'NO_TERMUX';
    throw err;
  }
}

module.exports = {
  phone_battery: {
    name: 'phone_battery',
    description: 'Get current battery status (Termux/Android only).',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      await ensureTermux();
      const r = await run('termux-battery-status');
      return parseJsonSafe(r.stdout) || { raw: r.stdout, stderr: r.stderr };
    },
  },

  phone_toast: {
    name: 'phone_toast',
    description: 'Show a short toast message on the phone screen.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    handler: async ({ text }) => {
      await ensureTermux();
      const safe = String(text).replace(/"/g, '\\"');
      const r = await run(`termux-toast "${safe}"`);
      return { ok: r.code === 0, stderr: r.stderr };
    },
  },

  phone_notify: {
    name: 'phone_notify',
    description: 'Post an Android notification.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
    handler: async ({ title, content }) => {
      await ensureTermux();
      const t = String(title).replace(/"/g, '\\"');
      const c = String(content).replace(/"/g, '\\"');
      const r = await run(`termux-notification --title "${t}" --content "${c}"`);
      return { ok: r.code === 0, stderr: r.stderr };
    },
  },

  phone_clipboard_get: {
    name: 'phone_clipboard_get',
    description: 'Read the phone clipboard.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      await ensureTermux();
      const r = await run('termux-clipboard-get');
      return { text: r.stdout };
    },
  },

  phone_clipboard_set: {
    name: 'phone_clipboard_set',
    description: 'Write text to the phone clipboard.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    handler: async ({ text }) => {
      await ensureTermux();
      const r = await run('termux-clipboard-set', { input: String(text) });
      return { ok: r.code === 0, stderr: r.stderr };
    },
  },

  phone_vibrate: {
    name: 'phone_vibrate',
    description: 'Vibrate the phone for N milliseconds (default 500).',
    parameters: {
      type: 'object',
      properties: { duration_ms: { type: 'number', default: 500 } },
      additionalProperties: false,
    },
    handler: async ({ duration_ms = 500 }) => {
      await ensureTermux();
      const r = await run(`termux-vibrate -d ${Number(duration_ms) | 0}`);
      return { ok: r.code === 0, stderr: r.stderr };
    },
  },

  phone_location: {
    name: 'phone_location',
    description:
      'Get current phone GPS location. Requires location permission for Termux:API.',
    parameters: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['gps', 'network', 'passive'],
          default: 'network',
        },
      },
      additionalProperties: false,
    },
    handler: async ({ provider = 'network' }) => {
      await ensureTermux();
      const r = await run(`termux-location -p ${provider}`, { timeoutMs: 30_000 });
      return parseJsonSafe(r.stdout) || { raw: r.stdout, stderr: r.stderr };
    },
  },

  phone_sms_send: {
    name: 'phone_sms_send',
    description:
      'Send an SMS. Requires SMS permission for Termux:API. USE WITH CAUTION.',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'string', description: 'Recipient phone number' },
        text: { type: 'string' },
      },
      required: ['number', 'text'],
      additionalProperties: false,
    },
    handler: async ({ number, text }) => {
      await ensureTermux();
      const n = String(number).replace(/[^0-9+]/g, '');
      const r = await run(`termux-sms-send -n ${n}`, { input: String(text) });
      return { ok: r.code === 0, stderr: r.stderr };
    },
  },

  phone_contacts: {
    name: 'phone_contacts',
    description: 'List phone contacts.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      await ensureTermux();
      const r = await run('termux-contact-list', { timeoutMs: 20_000 });
      return parseJsonSafe(r.stdout) || { raw: r.stdout };
    },
  },
};
