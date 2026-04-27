const { spawn } = require('child_process');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];
let shuttingDown = false;

function start(name, args) {
  const child = spawn(npmCmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  children.push({ name, child });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (signal) return;
    if (code && code !== 0) {
      console.error(`[up:desktop] ${name} exited with code ${code}`);
      shutdown(1);
    } else {
      console.warn(`[up:desktop] ${name} stopped.`);
    }
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(exitCode), 150);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[up:desktop] starting bot (npm start) and web (npm run web)...');
console.log('[up:desktop] press Ctrl+C to stop both processes.');
start('bot', ['run', 'start']);
start('web', ['run', 'web']);
