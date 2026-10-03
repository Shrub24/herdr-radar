'use strict';

// A configuration that owns its theme: `[theme] name = "terminal"` and its own
// `[theme.custom]`, with the plugin's tab bar and sidebar on top of it (a Nix or
// dotfiles seed). Two things have to hold for that to work.
//
// The export can leave the theme block out (`--print --blocks`), so there is no
// second `[theme.custom]` to collide with. And the runtime refresh that follows
// the desktop between light and dark edits only what the plugin owns: it does
// not swap `name` to a Herdr theme (which would undo `terminal`), does not turn
// `auto_switch` off, and does not leave a record behind for --uninstall to
// "restore" keys it never changed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const fixtures = require('../tools/test-fixtures');
const managed = require('../lib/managed-config');

const root = path.join(__dirname, '..');
const CONFIGURE = path.join(root, 'bin', 'configure.js');

function run(args, home) {
  return spawnSync(process.execPath, [CONFIGURE, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: fixtures.env(home),
  });
}

function sections(text) {
  return [...text.matchAll(/^\[([^\]]+)\]\s*$/gm)].map(([, name]) => name);
}

// `applyAppearance` in a child that has the fixture's HOME, as the plugin sees
// it when `theme-sync` runs; the config path is resolved from the environment
// when the module loads.
function applyAppearance(home, variant) {
  const script = `const r = require('./lib/managed-config').applyAppearance(process.argv[1]); process.stdout.write(JSON.stringify(r));`;
  const out = spawnSync(process.execPath, ['-e', script, variant], {
    cwd: root,
    encoding: 'utf8',
    env: fixtures.env(home),
  });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

// What a dotfiles seed looks like once the pieces are assembled: the user's own
// `[theme]` and `[theme.custom]`, the plugin's tab bar inside the user's `[ui]`,
// and the plugin's sidebar block.
function seed(home, variant, theme) {
  const exported = run(['--print', '--variant', variant, '--blocks', 'tabbar,sidebar'], home);
  assert.equal(exported.status, 0, exported.stderr);
  const text = exported.stdout;
  const cut = text.indexOf(managed.SIDEBAR_START);
  assert.ok(cut > 0, `could not split the export:\n${text}`);
  const tabbar = text.slice(text.indexOf('[ui]\n') + '[ui]\n'.length, cut).trim();
  const sidebar = text.slice(cut).trim();
  return [
    '[theme]',
    ...theme,
    '',
    '[theme.custom]',
    'accent = "#112233"',
    'panel_bg = "#000000"',
    '',
    '[ui]',
    'toast_delivery = "terminal"',
    tabbar,
    '',
    sidebar,
    '',
  ].join('\n');
}

const TERMINAL = ['name = "terminal"', 'auto_switch = false'];

test('--blocks leaves the theme table out and keeps the others', (t) => {
  const home = fixtures.home(t);
  const out = run(['--print', '--variant', 'dark', '--blocks', 'tabbar,sidebar'], home);

  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stderr, '', 'a pinned appearance has nothing to warn about');
  assert.deepEqual(sections(out.stdout).slice(0, 2), ['ui', 'ui.sidebar.agents']);
  assert.ok(!sections(out.stdout).includes('theme.custom'), 'no theme table to collide with the seed own');
  assert.ok(!out.stdout.includes(managed.THEME_START), 'no theme markers either');
});

test('the default export is the document it always was', (t) => {
  const home = fixtures.home(t);
  const plain = run(['--print', '--variant', 'dark'], home);
  const all = run(['--print', '--variant', 'dark', '--blocks', 'tabbar,theme,sidebar'], home);
  const shuffled = run(['--print', '--variant', 'dark', '--blocks', 'sidebar,theme,tabbar'], home);

  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(all.stdout, plain.stdout, 'naming every block is the default');
  assert.equal(shuffled.stdout, plain.stdout, 'the order they are named in does not move them');
  assert.ok(sections(plain.stdout).includes('theme.custom'));
});

test('the [ui] table is declared only when the tab bar is in the document', (t) => {
  const home = fixtures.home(t);
  const sidebarOnly = run(['--print', '--variant', 'dark', '--blocks', 'sidebar'], home);
  const tabbarOnly = run(['--print', '--blocks', 'tabbar'], home);
  const themeOnly = run(['--print', '--variant', 'light', '--blocks', 'theme'], home);

  assert.equal(sidebarOnly.status, 0, sidebarOnly.stderr);
  assert.ok(!sections(sidebarOnly.stdout).includes('ui'), 'the sidebar tables stand alone');
  assert.ok(sections(sidebarOnly.stdout).includes('ui.sidebar.agents'));

  assert.deepEqual(sections(tabbarOnly.stdout), ['ui']);
  assert.match(tabbarOnly.stdout, /tab_bar_right = \[/);

  assert.deepEqual(sections(themeOnly.stdout), ['theme.custom']);
});

test('the sidebar inks follow the pinned appearance, not the terminal theme', (t) => {
  const home = fixtures.home(t);
  fixtures.write(fixtures.paths(home).config, '[theme]\nname = "terminal"\n\n[ui]\n');

  const dark = run(['--print', '--variant', 'dark', '--blocks', 'tabbar,sidebar'], home);
  const light = run(['--print', '--variant', 'light', '--blocks', 'tabbar,sidebar'], home);
  assert.notEqual(dark.stdout, light.stdout, 'a terminal theme still gets the side that was asked for');
});

test('no appearance named: light, and stderr says so', (t) => {
  const home = fixtures.home(t);
  fixtures.write(fixtures.paths(home).config, '[theme]\nname = "terminal"\n\n[ui]\n');

  const unpinned = run(['--print', '--blocks', 'tabbar,sidebar'], home);
  const light = run(['--print', '--variant', 'light', '--blocks', 'tabbar,sidebar'], home);
  assert.equal(unpinned.status, 0, unpinned.stderr);
  assert.match(unpinned.stderr, /generated for light; pass --variant/);
  assert.equal(unpinned.stdout, light.stdout, 'the document itself is unchanged, only a note is added');

  const tabOnly = run(['--print', '--blocks', 'tabbar'], home);
  assert.equal(tabOnly.stderr, '', 'the tab bar has no colours to guess');
});

test('block names are checked before anything is printed', (t) => {
  const home = fixtures.home(t);
  for (const [args, status] of [
    [['--blocks', 'tabbar,themes'], 1],
    [['--blocks', ''], 1],
    [['--blocks', ','], 1],
    [['--blocks'], 2],
    [['--blocks', '--variant', 'dark'], 2],
  ]) {
    const out = run(['--print', ...args], home);
    assert.equal(out.status, status, `${args.join(' ')}: ${out.stderr}`);
    assert.equal(out.stdout, '', `${args.join(' ')} printed before it failed`);
    assert.match(out.stderr, /--blocks|no such block|no block named/);
  }
});

test('--blocks does not turn a write operation into a print', (t) => {
  const home = fixtures.home(t);
  const out = run(['--apply', '--blocks', 'sidebar'], home);
  assert.equal(out.stdout.includes('# herdr-radar'), false, 'only --print emits a document');
});

test('terminal theme: a refresh follows the desktop through the sidebar only', (t) => {
  const home = fixtures.home(t);
  const at = fixtures.paths(home);
  const original = seed(home, 'dark', TERMINAL);
  fixtures.write(at.config, original);

  const result = applyAppearance(home, 'light');
  assert.equal(result.ok, true, result.message);
  assert.equal(result.changed, true);
  const after = fs.readFileSync(at.config, 'utf8');

  // The user's own tables are byte-identical, and the name never moved.
  for (const kept of [
    '[theme]\nname = "terminal"\nauto_switch = false\n',
    '[theme.custom]\naccent = "#112233"\npanel_bg = "#000000"\n',
  ]) {
    assert.ok(after.includes(kept), `lost ${JSON.stringify(kept)}`);
  }
  assert.equal(after.match(/^name = /gm).length, 1);
  assert.equal(sections(after).filter((name) => name === 'theme.custom').length, 1, 'still the one foreign table');

  // What did change is the plugin's sidebar block, to the light inks.
  const sidebar = (text) => text.slice(text.indexOf(managed.SIDEBAR_START));
  assert.equal(sidebar(after), sidebar(seed(home, 'light', TERMINAL)));
  assert.notEqual(sidebar(after), sidebar(original));

  // Nothing of the user's `[theme]` was edited, so nothing is recorded to restore.
  assert.ok(!fs.existsSync(path.join(at.state, 'theme-origin.json')), 'a restore record for keys that never moved');
});

test('terminal theme: flipping back and forth returns the exact same file', (t) => {
  const home = fixtures.home(t);
  const at = fixtures.paths(home);
  const original = seed(home, 'dark', TERMINAL);
  fixtures.write(at.config, original);

  assert.equal(applyAppearance(home, 'light').changed, true);
  assert.equal(applyAppearance(home, 'light').changed, false, 'a second refresh for the same side is a no-op');
  assert.equal(applyAppearance(home, 'dark').changed, true);
  assert.equal(fs.readFileSync(at.config, 'utf8'), original);
});

test('terminal theme without a foreign [theme.custom]: the name still stays', (t) => {
  const home = fixtures.home(t);
  const at = fixtures.paths(home);
  const exported = run(['--print', '--variant', 'dark', '--blocks', 'sidebar'], home).stdout;
  const sidebar = exported.slice(exported.indexOf(managed.SIDEBAR_START));
  fixtures.write(at.config, `[theme]\nname = "terminal"\nauto_switch = true\n\n[ui]\n\n${sidebar}`);

  const result = applyAppearance(home, 'light');
  assert.equal(result.ok, true, result.message);
  const after = fs.readFileSync(at.config, 'utf8');
  assert.match(after, /^name = "terminal"$/m);
  assert.match(after, /^auto_switch = true$/m, "auto_switch is the user's too");
});

test('a named Herdr theme is still driven from light_name and dark_name', (t) => {
  const home = fixtures.home(t);
  const at = fixtures.paths(home);
  fixtures.write(
    at.config,
    seed(home, 'dark', [
      'name = "catppuccin"',
      'auto_switch = true',
      'light_name = "solarized-light"',
      'dark_name = "catppuccin"',
    ]),
  );

  const result = applyAppearance(home, 'light');
  assert.equal(result.ok, true, result.message);
  const after = fs.readFileSync(at.config, 'utf8');
  assert.match(after, /^name = "solarized-light"$/m);
  assert.match(after, /^auto_switch = false$/m);
  assert.ok(fs.existsSync(path.join(at.state, 'theme-origin.json')), 'edited keys are recorded for --uninstall');
});
