import { spawn } from 'node:child_process';
const [secs, cmd] = [Number(process.argv[2]), process.argv[3]];
if (!(secs > 0) || !cmd?.trim() || process.argv.length !== 4) {
  console.error("usage: node run-cmd.mjs <seconds> '<command>'");
  process.exit(2);
}
// shortcut: a child that calls setsid escapes the group; upgrade to a port check if a recipe does that
const child = spawn('/bin/sh', ['-c', cmd], { detached: true, stdio: 'inherit' });
const killGroup = (sig) => { try { process.kill(-child.pid, sig); } catch {} };
// the caller's own timeout signals us: take the group down with us, report it as a timeout
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => { killGroup('SIGKILL'); process.exit(124); });
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  killGroup('SIGTERM');
  setTimeout(() => killGroup('SIGKILL'), 5000);
}, secs * 1000);
child.on('exit', (code, sig) => {
  clearTimeout(timer);
  killGroup('SIGKILL'); // reap leftover background daemons
  process.exit(timedOut ? 124 : code ?? (sig ? 128 : 1));
});
