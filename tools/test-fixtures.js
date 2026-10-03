'use strict';

// Throwaway HOME trees for the tests that care what an install or a start
// writes: test/install-no-writes.test.js and test/startup-no-writes.test.js,
// and the export's own test (test/configure-print.test.js).
//
// Every path the plugin could write to lives inside the tree — Herdr's
// config.toml, both terminals' configs, and the user font directory that
// XDG_DATA_HOME points at — so "nothing was written" is a comparison of the
// whole tree rather than of a list somebody has to remember to extend.
//
// Two things are deliberate about the environment a child gets. `herdr` is a
// recording stub (never one of the session's own), and every inherited HERDR_*
// variable is dropped: a test run inside a Herdr pane carries HERDR_SOCKET_PATH
// and HERDR_BIN_PATH, and a child that inherits them talks to the machine's
// live server and writes to the machine's real state directory instead of the
// fixture.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const FONT_SOURCE = path.join(root, 'dist', 'HerdrAgentIconsMax-Regular.ttf');
const PLUGIN_ID = require('../lib/identity').PLUGIN_ID;

// The paths inside a fixture HOME that the plugin reads and may not write on
// an install or a start, plus the stub and its log.
function paths(home) {
  return {
    config: path.join(home, '.config', 'herdr', 'config.toml'),
    ghostty: path.join(home, '.config', 'ghostty', 'config'),
    kitty: path.join(home, '.config', 'kitty', 'kitty.conf'),
    fonts: path.join(home, '.local', 'share', 'fonts'),
    state: path.join(home, '.local', 'state', 'herdr', 'plugins', PLUGIN_ID),
    herdr: path.join(home, 'herdr-stub'),
    herdrCalls: path.join(home, 'herdr-calls.log'),
    pathCalls: path.join(home, 'path-calls.log'),
  };
}

// A fixture HOME with the directories the plugin expects to exist. The cleanup
// hook is registered here so every test gets it; a test that makes a directory
// read-only has to put the permission back itself before this runs.
function home(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-fixture-'));
  const at = paths(dir);
  for (const made of [path.dirname(at.config), at.fonts, at.state]) fs.mkdirSync(made, { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The environment a child gets: the fixture's paths, and nothing of this
// session's own Herdr.
function env(home, extra = {}) {
  const at = paths(home);
  const clean = { ...process.env };
  for (const key of Object.keys(clean)) if (key.startsWith('HERDR_')) delete clean[key];
  return {
    ...clean,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    HERDR_BIN_PATH: at.herdr,
    HERDR_SOCKET_PATH: path.join(home, '.config', 'herdr', 'herdr.sock'),
    ...extra,
  };
}

// A `herdr` that records its arguments and answers nothing. HERDR_BIN_PATH is
// spawned as a program, so this is a shebang script; on a platform that cannot
// run one the path is left absent, and a call that should not happen shows up
// as a spawn error instead (see assertNothingSpawned).
function stubHerdr(home) {
  const at = paths(home);
  if (process.platform === 'win32') return at.herdr;
  const script = [
    '#!/usr/bin/env node',
    `require('node:fs').appendFileSync(${JSON.stringify(at.herdrCalls)}, process.argv.slice(2).join(' ') + '\\n');`,
    '',
  ].join('\n');
  fs.writeFileSync(at.herdr, script);
  fs.chmodSync(at.herdr, 0o755);
  return at.herdr;
}

// PATH fronted by recorders for the programs a probe would reach for. The
// export must not ask fontconfig for the glyph table or a desktop for its
// appearance, and both are silent when they happen.
function recordingPath(home) {
  const dir = path.join(home, 'bin');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['fc-match', 'gsettings', 'defaults', 'reg']) {
    const file = path.join(dir, name);
    fs.writeFileSync(
      file,
      `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(paths(home).pathCalls)}, '${name}\\n');\n`,
    );
    fs.chmodSync(file, 0o755);
  }
  return process.env.PATH ? `${dir}${path.delimiter}${process.env.PATH}` : dir;
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

// The plugin's own config.toml where lib/config.js falls back to looking for it
// when Herdr did not inject HERDR_PLUGIN_CONFIG_DIR (a bare run from a
// checkout, which is what these tests are).
function pluginConfig(home, text) {
  return write(path.join(home, '.config', 'herdr', 'plugins', 'config', PLUGIN_ID, 'config.toml'), text);
}

// Every path under `dir`, directories included, with a file's bytes. These
// tests ask one question — did a byte change, or did a file appear — so this map
// is the whole answer.
function snapshot(dir) {
  const seen = new Map();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const key = path.relative(dir, full);
      if (entry.isSymbolicLink()) seen.set(key, `link -> ${fs.readlinkSync(full)}`);
      else if (entry.isDirectory()) {
        seen.set(`${key}/`, 'dir');
        walk(full);
      } else if (entry.isFile()) seen.set(key, fs.readFileSync(full, 'latin1'));
      else seen.set(key, 'other'); // a socket the daemon is serving on, say
    }
  };
  walk(dir);
  return seen;
}

// Only the files a start may not touch. The daemon's own state directory is
// left out on purpose: writing there is its job, and it does.
function userSnapshot(home) {
  const at = paths(home);
  const seen = new Map();
  for (const file of [at.config, at.ghostty, at.kitty]) {
    seen.set(file, fs.existsSync(file) ? fs.readFileSync(file, 'latin1') : null);
  }
  for (const [key, content] of snapshot(at.fonts)) seen.set(`fonts/${key}`, content);
  return seen;
}

function assertUnchanged(before, after, what) {
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), `${what}: the files present changed`);
  for (const [file, content] of before) assert.equal(after.get(file), content, `${what}: ${file} changed`);
}

// Where the stub can be spawned, a call that should not happen has left a log
// file. Where it cannot (Windows), the stub path does not exist and such a call
// fails instead — the other assertions in the test still hold.
function assertNothingSpawned(home, what) {
  if (process.platform === 'win32') return;
  assert.equal(fs.existsSync(paths(home).herdrCalls), false, `${what} called the herdr binary`);
  assert.equal(fs.existsSync(paths(home).pathCalls), false, `${what} probed the machine (fc-match/gsettings)`);
}

// Herdr's config as it ships: a `[ui]` table for the managed block to attach
// to, a theme the plugin's colours can follow, and a key of the user's own that
// must survive untouched.
function coldConfig() {
  return ['# my own config', '[theme]', 'name = "catppuccin-latte"', '', '[ui]', 'tab_bar_position = "top"', ''].join(
    '\n',
  );
}

// A config whose managed blocks are already installed. `variantTag` is written
// into the sidebar block's glyph line, so a fixture can carry the mismatch the
// daemon used to "repair" on every start — the one write a previously
// configured machine could not avoid.
function installedConfig(variantTag) {
  const managed = require('../lib/managed-config');
  const theme = [`${managed.THEME_START}`, '[theme.custom]', 'active_row_bg = "#b9cdf2"', `${managed.THEME_END}`].join(
    '\n',
  );
  const sidebar = managed
    .sidebarBlock('light', 'text')
    .replace(/^# logo glyphs: \w+$/m, `# logo glyphs: ${variantTag}`);
  return [coldConfig(), managed.block(), '', theme, '', sidebar, ''].join('\n');
}

// The shipped face under the content-hash name lib/font.js installs it as, so a
// fixture can stand for a machine where the font is already in place.
function installFont(home) {
  const at = paths(home);
  fs.mkdirSync(at.fonts, { recursive: true });
  const hash = crypto.createHash('sha256').update(fs.readFileSync(FONT_SOURCE)).digest('hex').slice(0, 8);
  const target = path.join(at.fonts, `HerdrAgentIconsMax-${hash}.ttf`);
  fs.copyFileSync(FONT_SOURCE, target);
  return target;
}

module.exports = {
  paths,
  home,
  env,
  stubHerdr,
  recordingPath,
  write,
  pluginConfig,
  snapshot,
  userSnapshot,
  assertUnchanged,
  assertNothingSpawned,
  coldConfig,
  installedConfig,
  installFont,
};
