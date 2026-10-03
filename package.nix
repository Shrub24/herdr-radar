# Herdr Radar as a Nix package. The derivation's output IS the plugin root —
# the directory `herdr plugin link` registers — so `$out/herdr-plugin.toml` is
# the manifest Herdr reads and `$out/bin/*.js` are the scripts its commands run.
#
#   nix-build -E 'with import <nixpkgs> {}; callPackage ./package.nix {}'
#   herdr plugin link ./result
#
# Every manifest command is rewritten at build time to run the pinned Node by
# absolute path. Herdr runs a bare `node` from the PATH it inherited, which a
# Nix-managed install does not promise; an absolute interpreter in the store is
# the smallest way to make the commands self-contained on every platform.
#
# Nothing writable is installed: the store is read-only, and the plugin keeps
# its state under `HERDR_PLUGIN_STATE_DIR` and its settings under
# `HERDR_PLUGIN_CONFIG_DIR`, which Herdr creates outside the store.
{
  lib,
  stdenv,
  nodejs_22,
  python3,
  runCommand,
}:

let
  version = (lib.importJSON ./package.json).version;

  # Committed files only. `lib.fileset` leaves `.git`, `.pi`, `node_modules`
  # (the package has no runtime npm dependencies — prettier is a
  # devDependency), `test/`, `tools/` and any local `result` symlink out.
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
      ./bin
      ./lib
      ./assets
      ./dist
      ./shell
      ./herdr-plugin.toml
      ./package.json
      ./LICENSE
      ./THIRD_PARTY_NOTICES.md
    ];
  };
in
lib.fix (self: stdenv.mkDerivation {
  pname = "herdr-radar";
  inherit version src;

  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out
    cp -r bin lib assets dist shell $out/
    install -m 0644 herdr-plugin.toml package.json LICENSE THIRD_PARTY_NOTICES.md $out/
    chmod 0755 $out/bin/*.js

    # Both the manifest's commands and the scripts' shebangs point at this
    # Node by absolute path. Herdr runs a bare `node` from the PATH it
    # inherited (`src/plugin_command.rs`), and the scripts are also meant to be
    # runnable straight from `$out/bin`.
    substituteInPlace $out/herdr-plugin.toml \
      --replace-fail '["node",' '["${nodejs_22}/bin/node",'
    substituteInPlace $out/bin/*.js \
      --replace-fail '#!/usr/bin/env node' '#!${nodejs_22}/bin/node'

    runHook postInstall
  '';

  passthru = {
    # The interpreter the built manifest runs.
    node = nodejs_22;

    # Runs the packaged plugin read-only, in a throwaway HOME, with no Herdr
    # server: `nix-build ... -A tests.smoke`.
    tests.smoke = runCommand "herdr-radar-smoke" { nativeBuildInputs = [ python3 ]; } ''
      bash ${./nix/package-smoke.sh} ${self}
      touch $out
    '';
  };

  meta = {
    description = "Vendor logos, lifecycle-state glyphs, workspace grouping and a path tab-bar for the Herdr sidebar";
    homepage = "https://github.com/hhdebb/herdr-radar";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
})
