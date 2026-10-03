'use strict';

// What a first start used to do to the user's machine, and no longer does.
//
// A build hook, a daemon start and a tick are not consent to write Herdr's
// config.toml, a terminal's config or the user's font directory. Those writes
// belong to the commands that are asked for them — the `configure`,
// `install-font` and `theme-sync` actions — so a machine whose configuration
// is generated instead (Nix, Home Manager, a dotfiles repo) renders the plugin
// with none of them ever running, and nothing here fails on a target it may
// not touch.
//
// Everything in this module reads. It answers which of those commands a fresh
// install has not run yet, so the build hook can name them once, in the install
// log, which is where a user who just installed is looking anyway.
//
// The stamp this module used to keep (`setup.done`) went with the writes: it
// carried the font's content hash so a release that shipped a new font set up
// again on the next start, and with nothing installed on a start there is
// nothing left to record.

// What is in place for this user right now. Both answers are reads: the
// markers in Herdr's config file, and the font this plugin installs into the
// user's font directory.
function status() {
  const report = require('./managed-config').inspect();
  return {
    configFile: report.file,
    configured: report.state === 'installed',
    fontInstalled: require('./font').isInstalled(),
  };
}

module.exports = { status };
