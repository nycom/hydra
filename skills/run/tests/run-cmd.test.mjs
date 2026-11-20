import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../run-cmd.mjs', import.meta.url));
const run = (secs, cmd) => spawnSync('node', [script, String(secs), cmd], { encoding: 'utf8' });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const dies = async (pid) => {
  for (let i = 0; i < 20 && alive(pid); i++) await new Promise((res) => setTimeout(res, 100));
  return !alive(pid);
};

test('timeout kills the command and its children, exits 124', async () => {
  const t = Date.now();
  const r = run(1, 'sleep 60 & echo $!; wait');
  assert.equal(r.status, 124);
  assert.ok(Date.now() - t < 7000);
  assert.ok(await dies(Number(r.stdout.trim())));
});

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  test(`${sig} to the wrapper kills the group, exits 124`, async () => {
    const p = spawn('node', [script, '60', 'sleep 64 & echo $!; wait'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const pid = await new Promise((res) => p.stdout.once('data', (d) => res(Number(String(d).trim()))));
    const code = new Promise((res) => p.on('exit', res));
    p.kill(sig);
    assert.equal(await code, 124);
    assert.ok(await dies(pid), 'grandchild still alive');
  });
}

test('background process is killed on normal exit', async () => {
  const r = run(10, 'sleep 30 & echo $!');
  assert.equal(r.status, 0);
  const pid = Number(r.stdout.trim());
  assert.ok(pid > 0);
  for (let i = 0; i < 20 && alive(pid); i++) await new Promise((res) => setTimeout(res, 100));
  assert.equal(alive(pid), false);
});

test('exit code passes through', () => {
  assert.equal(run(10, 'exit 3').status, 3);
});

test('quoted command runs as written', () => {
  const r = run(10, `node -e 'console.log("a b")'`);
  assert.equal(r.stdout.trim(), 'a b');
});

test('bad args exit 2', () => {
  assert.equal(run(0, 'true').status, 2);
  assert.equal(run(5, '  ').status, 2);
});
