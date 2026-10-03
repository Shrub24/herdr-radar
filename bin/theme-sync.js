#!/usr/bin/env node
'use strict';

require('../lib/node-version');

// Keep the managed theme block in step with the desktop's appearance.
//
//   node bin/theme-sync.js           rewrite and reload, if it flipped since
//                                    this last ran
//   node bin/theme-sync.js --force   rewrite and reload regardless
//   node bin/theme-sync.js --check   print what it would do
//
// Herdr's `auto_switch` swaps the theme when the host goes light or dark, but
// `[theme.custom]` is one static table — it cannot hold a value per
// appearance. This is how the tokens this plugin owns are swapped to match:
// after a flip, run the `theme-sync` action (or this command by hand).
//
// Nothing runs it on its own any more. The resident daemon used to spawn it
// once a minute, which meant a background process editing Herdr's config
// without being asked — a configuration that is generated instead (Nix, Home
// Manager, dotfiles) either fails on a read-only target or drifts out of step
// when that happens. `follow_appearance` still decides whether this reads the
// desktop at all: with it false, nothing short of `--force` does anything.

const appearance = require('../lib/appearance');
const config = require('../lib/config');
const managed = require('../lib/managed-config');
const { reloadConfig } = require('../lib/herdr');

// `follow_appearance = false` turns the automatic path off; `--force` is an
// explicit request and still goes through.
function sync({ force = false } = {}) {
  if (!config.followAppearance && !force) return { changed: false, variant: null, off: true };
  const variant = force ? appearance.current(Date.now(), { fresh: true }) : appearance.takeChange();
  if (!variant) return { changed: false, variant: appearance.current() };
  const result = managed.applyAppearance(variant);
  if (result.ok && result.changed) reloadConfig();
  return { ...result, variant };
}

if (require.main === module) {
  const mode = process.argv.find((argument) => argument.startsWith('--'));
  if (mode === '--check') {
    console.log(`appearance: ${appearance.current() ?? 'unknown'}`);
  } else {
    const result = sync({ force: mode === '--force' });
    console.log(
      result.off
        ? 'follow_appearance = false; nothing to do (use --force to apply once)'
        : result.changed
          ? `theme block -> ${result.variant}`
          : `unchanged (${result.variant ?? 'unknown'})`,
    );
  }
}

module.exports = { sync };
