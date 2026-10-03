'use strict';

// A daemon start writes nothing the user owns — the launcher Herdr runs as a
// startup hook (bin/agent-state.js) and the daemon itself (lib/daemon.js).
//
// Two writes lived here. The launcher ran the whole first-run setup before it
// even asked whether a daemon was already answering: the managed blocks, the
// font and the terminal maps, on every start of a machine without the stamp.
// And the daemon rewrote the managed sidebar block whenever the glyph variant
// inside it no longer matched what this machine resolves, on every start, plus
// the same blocks on a minute timer. Both are gone; the blocks belong to the
// `configure` and `theme-sync` actions, which are asked for.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const fixtures = require('../tools/test-fixtures');

const root = path.join(__dirname, '..');
const LAUNCHER = path.join(root, 'bin', 'agent-state.js');

function run(args, home) {
  return spawnSync(process.execPath, [LAUNCHER, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: fixtures.env(home),
  });
}

// The launcher asks the control endpoint whether a daemon is already serving,
// and in that test the endpoint is this process — so it has to be spawned
// asynchronously. A synchronous spawn blocks the event loop that would answer
// the ping, the launcher concludes after its timeout that nobody is there, and
// the test measures the wrong thing entirely.
function runAsync(args, home) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [LAUNCHER, ...args], {
      cwd: root,
      env: fixtures.env(home),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const stuck = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('close', (status) => {
      clearTimeout(stuck);
      resolve({ status, stdout, stderr });
    });
  });
}

// A control endpoint that answers a ping like a live daemon. The launcher asks
// one question first — is somebody already serving — and a test that lets it
// decide "no" would have it start a real daemon instead.
function servePing(t, socket) {
  const sockets = new Set();
  const server = net.createServer((stream) => {
    sockets.add(stream);
    stream.on('close', () => sockets.delete(stream));
    stream.on('data', () => stream.end(`${JSON.stringify({ ok: true, pid: process.pid, fire_age_ms: 0 })}\n`));
    stream.on('error', () => stream.destroy());
  });
  // `close` waits for every accepted connection to end, and a client that
  // destroyed its half first can keep one open — so they are ended here.
  t.after(
    () =>
      new Promise((resolve) => {
        for (const open of sockets) open.destroy();
        server.close(() => resolve());
      }),
  );
  return new Promise((resolve) => server.listen(socket, resolve));
}

test('a start with a daemon already running writes nothing', async (t) => {
  if (process.platform === 'win32') {
    t.skip('the control endpoint is a per-user named pipe on Windows, which a test cannot serve');
    return;
  }
  const home = fixtures.home(t);
  const at = fixtures.paths(home);
  fixtures.stubHerdr(home);
  fixtures.write(at.config, fixtures.coldConfig());
  fixtures.write(at.ghostty, 'font-family = "JetBrains Mono"\n');
  await servePing(t, path.join(at.state, 'control.sock'));
  const before = fixtures.snapshot(home);

  const out = await runAsync([], home);

  assert.equal(out.status, 0, out.stderr);
  fixtures.assertUnchanged(before, fixtures.snapshot(home), 'the launcher');
  fixtures.assertNothingSpawned(home, 'the launcher');
});

// `--animate` runs the real daemon in the fixture. With no herdr socket in
// there, its event subscription gives up at once and it exits by itself
// (lib/subscribe.js), so the start is a whole one, not a partial one.
test('a daemon start leaves the managed blocks alone', (t) => {
  const home = fixtures.home(t);
  const at = fixtures.paths(home);
  fixtures.stubHerdr(home);
  // `variant = "text"` settles the glyph table this machine resolves and leaves
  // the fixture's `# logo glyphs: font` a mismatch on every machine — the
  // reading the daemon used to repair at startup, and the reason a generated
  // config could not stay in place.
  fixtures.pluginConfig(home, 'variant = "text"\n');
  fixtures.write(at.config, fixtures.installedConfig('font'));
  fixtures.installFont(home);
  const before = fixtures.userSnapshot(home);

  const out = run(['--animate'], home);

  assert.equal(out.status, 0, `${out.stderr}${out.stdout}`);
  fixtures.assertUnchanged(before, fixtures.userSnapshot(home), 'the daemon');
});
