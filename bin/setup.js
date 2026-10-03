#!/usr/bin/env node
'use strict';

require('../lib/node-version');

// The manifest's `[[build]]` hook — Herdr runs it when the plugin is installed
// from GitHub, and its output is what the install preview shows — and a plain
// report by hand:
//
//   node bin/setup.js     what this install has left for you to run
//
// It writes NOTHING of yours, and it starts NOTHING.
//
// Nothing, because an install is not consent to edit Herdr's config.toml, a
// terminal's config or the user's font directory. A generated configuration
// (Nix, Home Manager, a dotfiles repo) either fails on a read-only target or
// silently drifts out of step when those writes happen, so they belong to the
// actions that are asked for them: `configure`, `install-font`, `theme-sync`.
// This hook used to do all of it on the first start instead, and the first
// start after a release that changed the font did it again (lib/setup.js).
//
// Nothing that runs, either, and that is older than the above: the build hook
// runs inside Herdr's temporary checkout, which Herdr renames into place once
// the hook is done — and a daemon started from here inherits that checkout as
// its working directory. On Windows a directory that is some process's cwd
// cannot be renamed, so the install failed with os error 32 on every Windows
// machine (#23). The daemon starts from the startup hooks and the `state-start`
// action instead, once the plugin is where it will stay.

const setup = require('../lib/setup');
const { NAME } = require('../lib/identity');
const { pluginId } = require('../lib/paths');

const status = setup.status();
const todo = [];
if (!status.configured) {
  todo.push(['configure', "the sidebar, tab-bar and theme blocks in Herdr's config.toml"]);
}
if (!status.fontInstalled) {
  todo.push(['install-font', 'the icon font and the codepoint map in ghostty/kitty']);
}

if (todo.length === 0) {
  console.log(`${NAME}: the managed blocks and the icon font are already in place; nothing to run`);
} else {
  console.log(`${NAME}: nothing was written to Herdr's config, your terminals or your fonts.`);
  console.log('Run these when you want them:');
  for (const [action, what] of todo) {
    console.log(`  herdr plugin action invoke ${pluginId()}.${action}   # ${what}`);
  }
  console.log(
    'For a config you generate yourself, `node bin/configure.js --print` prints the blocks and writes nothing.',
  );
}
