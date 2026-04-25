const { spawn } = require('child_process');
const settings = require('../core/settings');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];

function start(name, args) {
  const child = spawn(npmCmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      console.error(`[web:dev] ${name} exited with code ${code}`);
    }
  });
  return child;
}

function stopAll() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on('SIGINT', () => {
  stopAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopAll();
  process.exit(0);
});

async function main() {
  const s = await settings.getSettings();
  const apiPort = s.web.port || 8787;
  const devPort = 5173;

  console.log('[web:dev] starting API server and Vite dashboard...');
  console.log(`[web:dev] open http://127.0.0.1:${devPort}/?token=${s.web.token}`);
  console.log(`[web:dev] API proxy target http://127.0.0.1:${apiPort}`);

  start('api', ['run', 'web']);
  start('vite', ['run', 'web:dev:client']);
}

main().catch((err) => {
  console.error('[web:dev] failed:', err.message);
  stopAll();
  process.exit(1);
});
