const { exec } = require('child_process');
const config = require('../../config');

function runCommand(command, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve) => {
    const child = exec(
      command,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          code: error && error.code != null ? error.code : 0,
          stdout: String(stdout || '').slice(-4000),
          stderr: String(stderr || '').slice(-4000),
          error: error ? error.message : null,
        });
      }
    );
    child.on('error', () => {
      // handled in callback
    });
  });
}

module.exports = {
  run_shell: {
    name: 'run_shell',
    description:
      'Execute a shell command on the host (phone via Termux, or dev machine). ' +
      'DISABLED by default for safety. Enable by setting ALLOW_SHELL=true in .env. ' +
      'Use sparingly; prefer dedicated tools when they exist.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run' },
        timeout_ms: {
          type: 'number',
          description: 'Timeout in milliseconds (default 15000)',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
    handler: async ({ command, timeout_ms }) => {
      if (!config.safety.allowShell) {
        return {
          blocked: true,
          reason:
            'Shell execution is disabled. Set ALLOW_SHELL=true in .env to enable.',
        };
      }
      return runCommand(command, { timeoutMs: timeout_ms });
    },
  },
};
