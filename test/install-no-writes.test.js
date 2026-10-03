'use strict';

// An install writes nothing the user owns: bin/setup.js, the manifest's
// `[[build]]` hook, and lib/setup.js behind it.
//
// The build hook — and, before that, the first daemon start — used to write the
// three managed blocks into Herdr's config.toml, copy the icon font into the
// user's font directory and map its codepoints in ghostty/kitty configs, on
// every machine and without being asked. A configuration that is generated
// instead (Nix, Home Manager, a dotfiles repo) either fails on a read-only
// target or drifts out of step when that happens, so the install path is pinned
// to reading here: a fixture HOME carries every file it could write to, and the
// whole tree is compared around the run.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const fixtures = require('../tools/test-fixtures');

const root = path.join(__dirname, '..');
const SETUP = path.join(root, 'bin', 'setup.js');

function run(args, home) {
  return spawnSync(process.execPath, [SETUP, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: fixtures.env(home),
  });
}

test('a cold install writes nothing: no blocks, no font, no terminal map', (t) => {
  const home = fixtures.home(t);
  const at = fixtures.paths(home);
  fixtures.stubHerdr(home);
  fixtures.write(at.config, fixtures.coldConfig());
  fixtures.write(at.ghostty, 'font-family = "JetBrains Mono"\n');
  const before = fixtures.snapshot(home);

  const out = run([], home);

  assert.equal(out.status, 0, out.stderr);
  fixtures.assertUnchanged(before, fixtures.snapshot(home), 'the build hook');
  fixtures.assertNothingSpawned(home, 'the build hook');
  assert.match(out.stdout, /\.configure/, 'the report names the configure action');
  assert.match(out.stdout, /\.install-font/, 'the report names the font action');
});

test('an already configured machine is left exactly as it was', (t) => {
  const home = fixtures.home(t);
  const at = fixtures.paths(home);
  fixtures.stubHerdr(home);
  // `variant = "text"` settles what the plugin resolves on every machine, so
  // the fixture's `# logo glyphs: font` is a mismatch everywhere rather than
  // only where fontconfig has the icon font. The old hook rewrote the block on
  // exactly that reading — its own first start did it too.
  fixtures.pluginConfig(home, 'variant = "text"\n');
  fixtures.write(at.config, fixtures.installedConfig('font'));
  fixtures.installFont(home);
  fixtures.write(at.ghostty, 'font-family = "JetBrains Mono"\n');
  fixtures.write(at.kitty, 'font_family JetBrains Mono\n');
  const before = fixtures.snapshot(home);

  const out = run([], home);

  assert.equal(out.status, 0, out.stderr);
  fixtures.assertUnchanged(before, fixtures.snapshot(home), 'the build hook');
  fixtures.assertNothingSpawned(home, 'the build hook');
  assert.match(out.stdout, /already in place/, 'the report says there is nothing to run');
});

test('a read-only config is reported, not written to, and the install does not fail', (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    t.skip('read-only directories are not a guarantee here (Windows, or root)');
    return;
  }
  const home = fixtures.home(t);
  const at = fixtures.paths(home);
  fixtures.stubHerdr(home);
  fixtures.write(at.config, fixtures.coldConfig());
  fixtures.write(at.ghostty, 'font-family = "JetBrains Mono"\n');
  // The whole point of the case: nothing in Herdr's config directory can be
  // written at all, which is what a store path looks like. A hook that writes
  // anyway fails here — on the temporary file, before it can even rename.
  fs.chmodSync(at.config, 0o444);
  fs.chmodSync(path.dirname(at.config), 0o555);
  const before = fixtures.snapshot(home);

  let out;
  try {
    out = run([], home);
  } finally {
    fs.chmodSync(path.dirname(at.config), 0o755);
    fs.chmodSync(at.config, 0o644);
  }

  assert.equal(out.status, 0, out.stderr);
  fixtures.assertUnchanged(before, fixtures.snapshot(home), 'the build hook');
  assert.match(out.stdout, /\.configure/, 'the report names the configure action');
});

test('a symlinked config stays a symlink and its target is untouched', (t) => {
  const home = fixtures.home(t);
  const at = fixtures.paths(home);
  fixtures.stubHerdr(home);
  const target = fixtures.write(path.join(home, 'dotfiles', 'herdr-config.toml'), fixtures.coldConfig());
  try {
    fs.symlinkSync(target, at.config);
  } catch {
    t.skip('this platform cannot make a symlink (Windows without developer mode)');
    return;
  }
  const before = fixtures.snapshot(home);

  const out = run([], home);

  assert.equal(out.status, 0, out.stderr);
  fixtures.assertUnchanged(before, fixtures.snapshot(home), 'the build hook');
  assert.equal(fs.lstatSync(at.config).isSymbolicLink(), true, 'the config link was replaced by a plain file');
});

// The hook is allowed to be run by hand, and it is the same code either way:
// the report is the only thing that changes with what is installed.
test('the report asks only for what is missing', (t) => {
  const home = fixtures.home(t);
  const at = fixtures.paths(home);
  fixtures.stubHerdr(home);
  fixtures.write(at.config, fixtures.installedConfig('text'));
  fixtures.pluginConfig(home, 'variant = "auto"\n');

  const out = run([], home);

  assert.equal(out.status, 0, out.stderr);
  assert.doesNotMatch(out.stdout, /\.configure/, 'the blocks are installed');
  assert.match(out.stdout, /\.install-font/, 'the font is not installed');
});
