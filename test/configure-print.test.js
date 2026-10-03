'use strict';

// `node bin/configure.js --print`: the managed blocks as one complete TOML
// document, emitted instead of written (lib/managed-config.js exportText).
//
// This is the declarative half of the config ownership split — a configuration
// that is generated rather than edited (Home Manager, a dotfiles template, a
// read-only store path) consumes these blocks instead of letting an install
// write the file behind it. Three things make it usable there, and each is
// pinned below: the document is complete TOML (`[ui]` is declared, because the
// tab-bar keys are bare keys of that table), it is generated free of any desktop
// or fontconfig probe, and it writes and spawns nothing at all.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const fixtures = require('../tools/test-fixtures');
const managed = require('../lib/managed-config');
const palette = require('../lib/palette');

const root = path.join(__dirname, '..');
const CONFIGURE = path.join(root, 'bin', 'configure.js');
const SECTIONS = ['ui', 'theme.custom', 'ui.sidebar.agents', 'ui.sidebar.agents.rows_by_agent', 'ui.sidebar.spaces'];

function print(args, home, extra) {
  return run(['--print', ...args], home, extra);
}

function run(args, home, extra) {
  return spawnSync(process.execPath, [CONFIGURE, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: fixtures.env(home, extra),
  });
}

// The sidebar block as the export would build it in this fixture. It has to be
// read out of a child with the same environment rather than from this process:
// the vendor rows come from the detector manifests under the HOME in play, and
// this process's HOME is the machine's own.
function expectedSidebar(home, variant, glyphs, extra) {
  const script = "process.stdout.write(require('./lib/managed-config').sidebarBlock(process.argv[1], process.argv[2]))";
  const out = spawnSync(process.execPath, ['-e', script, variant, glyphs], {
    cwd: root,
    encoding: 'utf8',
    env: fixtures.env(home, extra),
  });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout;
}

// Every table header in the document, in the order it appears. A dump of the
// blocks alone cannot answer the question this does: whether the tab-bar keys
// ended up inside `[ui]`, or beside a `[ui]` the user already has — which TOML
// refuses, and which takes every plugin down with the config.
function sections(text) {
  return [...text.matchAll(/^\[([^\]]+)\]\s*$/gm)].map(([, name]) => name);
}

test('the operation is detected whichever order its flags come in', (t) => {
  const home = fixtures.home(t);

  // `--variant` before `--print` used to be read as the mode itself, fall
  // through to the status report, and exit 0 without printing the document at
  // all — a silent success. Both orders have to print the same, complete
  // document, and both have to write nothing.
  const before = fixtures.snapshot(home);
  const pinned = print(['--variant', 'dark'], home);
  const asked = run(['--variant', 'dark', '--print'], home);

  assert.equal(pinned.status, 0, pinned.stderr);
  assert.equal(asked.status, 0, asked.stderr);
  assert.equal(asked.stdout, pinned.stdout, '--print after --variant printed something else');
  assert.deepEqual(sections(asked.stdout), SECTIONS);
  assert.equal(managed.blockVariant(asked.stdout), 'text');
  fixtures.assertUnchanged(before, fixtures.snapshot(home), 'the export');
});

test('conflicting operations are refused without writing or spawning', (t) => {
  const home = fixtures.home(t);
  fixtures.stubHerdr(home);
  const before = fixtures.snapshot(home);
  for (const args of [
    ['--print', '--apply'],
    ['--apply', '--print'],
    ['--check', '--print'],
  ]) {
    const out = run(args, home);
    assert.equal(out.status, 2, `${args.join(' ')}: ${out.stderr}${out.stdout}`);
    assert.match(out.stderr, /one operation/);
    fixtures.assertUnchanged(before, fixtures.snapshot(home), 'conflicting operations');
    fixtures.assertNothingSpawned(home, 'conflicting operations');
  }
});

test('--variant prints a complete document with the tab-bar keys inside [ui]', (t) => {
  const home = fixtures.home(t);

  const out = print(['--variant', 'dark'], home);

  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(sections(out.stdout), SECTIONS);
  const lines = out.stdout.split('\n');
  const ui = lines.indexOf('[ui]');
  const theme = lines.indexOf('[theme.custom]');
  assert.ok(ui >= 0 && theme > ui, 'the document declares [ui] before the theme block');
  assert.ok(
    lines.slice(ui + 1, theme).some((line) => line.startsWith('tab_bar_right =')),
    'the tab-bar keys are not inside [ui]',
  );
  assert.equal(managed.blockVariant(out.stdout), 'text');
  assert.ok(
    out.stdout.includes(`active_row_bg = "${palette.chrome.dark.active_row_bg}"`),
    'the pinned appearance is not in the theme block',
  );
  assert.ok(out.stdout.includes(expectedSidebar(home, 'dark', 'text')), 'the pinned variant is not in the document');
});

test('without --variant the config on disk decides, and names no theme means no theme block', (t) => {
  const home = fixtures.home(t);
  fixtures.write(fixtures.paths(home).config, ['[theme]', 'name = "catppuccin-latte"', '', '[ui]', ''].join('\n'));

  const light = print([], home);
  assert.equal(light.status, 0, light.stderr);
  assert.ok(
    light.stdout.includes(expectedSidebar(home, 'light', 'text')),
    'a light theme name did not pick the light rows',
  );
  assert.ok(light.stdout.includes(managed.THEME_START), 'a named theme should carry the theme block');

  fixtures.write(fixtures.paths(home).config, ['[theme]', 'name = "terminal"', '', '[ui]', ''].join('\n'));
  const none = print([], home);
  assert.equal(none.status, 0, none.stderr);
  assert.ok(!none.stdout.includes(managed.THEME_START), 'a terminal-owned theme has no chrome colours to override');
});

test('the glyph table follows the plugin config, never fontconfig', (t) => {
  const home = fixtures.home(t);
  fixtures.write(fixtures.paths(home).config, fixtures.coldConfig());
  const searchPath = fixtures.recordingPath(home);

  // No font is installed in the fixture, so `auto` means plain Unicode — the
  // same answer lib/logos.js gives at render time, minus its fc-match question.
  const auto = print([], home, { PATH: searchPath });
  assert.equal(auto.status, 0, auto.stderr);
  assert.equal(managed.blockVariant(auto.stdout), 'text');

  fixtures.pluginConfig(home, 'variant = "font"\n');
  const pinned = print([], home, { PATH: searchPath });
  assert.equal(pinned.status, 0, pinned.stderr);
  assert.equal(managed.blockVariant(pinned.stdout), 'font');
  assert.ok(pinned.stdout.includes(expectedSidebar(home, 'light', 'font')), 'the declared glyph variant is not used');
});

test('the document is deterministic and the print writes and spawns nothing', (t) => {
  const home = fixtures.home(t);
  const at = fixtures.paths(home);
  fixtures.stubHerdr(home);
  const searchPath = fixtures.recordingPath(home);
  fixtures.write(at.config, fixtures.coldConfig());
  const before = fixtures.snapshot(home);

  const first = print(['--variant', 'light'], home, { PATH: searchPath });
  const second = print(['--variant', 'light'], home, { PATH: searchPath });

  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout, 'two runs disagreed');
  fixtures.assertUnchanged(before, fixtures.snapshot(home), 'the export');
  fixtures.assertNothingSpawned(home, 'the export');
});

test('an appearance it does not know is refused', (t) => {
  const home = fixtures.home(t);

  const out = print(['--variant', 'blue'], home);

  assert.equal(out.status, 2);
  assert.match(out.stderr, /light or dark/);
});
