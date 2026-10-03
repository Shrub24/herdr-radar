#!/usr/bin/env bash
# Package-only smoke test: exercise the built plugin root read-only, in a
# throwaway HOME, with no Herdr server, and fail on anything that writes
# outside the plugin's own state directory.
#
#   bash nix/package-smoke.sh ./result
#
# Wired up as `passthru.tests.smoke`:
#   nix-build -E 'with import <nixpkgs> {}; callPackage ./package.nix {}' -A tests.smoke
#
# The plugin's own node_modules is never needed (there are no runtime npm
# dependencies), and python3 is used only to parse the manifest and the
# exported TOML.
set -euo pipefail

root=${1:?usage: package-smoke.sh <plugin-root>}
root=$(cd "$root" && pwd -P)
[ -f "$root/herdr-plugin.toml" ] || { echo "FAIL: no herdr-plugin.toml at $root" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The manifest runs a pinned interpreter, not whatever `node` is on PATH.
node=$(sed -n 's#.*\["\(/[^"]*/bin/node\)",.*#\1#p' "$root/herdr-plugin.toml" | head -n1)
[ -n "$node" ] || { echo "FAIL: manifest does not pin an absolute Node runtime" >&2; exit 1; }
[ -x "$node" ] || { echo "FAIL: pinned Node is not executable: $node" >&2; exit 1; }
echo "ok: manifest pins Node runtime $node"

# A HOME of its own, and a socket path that cannot connect: an install, a
# status read and the pure export must never need a running Herdr server.
export HOME="$tmp/home"
export XDG_CONFIG_HOME="$tmp/config"
export XDG_STATE_HOME="$tmp/state"
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME"
export HERDR_SOCKET_PATH="$tmp/no-such.sock"
unset HERDR_PLUGIN_STATE_DIR HERDR_PLUGIN_CONFIG_DIR HERDR_ENV HERDR_BIN_PATH

python3 - "$root" "$node" <<'PY'
import json
import sys
import tomllib

root, node = sys.argv[1], sys.argv[2]
manifest = tomllib.load(open(f"{root}/herdr-plugin.toml", "rb"))
pkg = json.load(open(f"{root}/package.json"))
assert manifest["id"] == "hhdebb.herdr-radar", manifest["id"]
assert manifest["version"] == pkg["version"], (manifest["version"], pkg["version"])
commands = [
    entry["command"]
    for section in ("actions", "startup", "panes", "build", "events")
    for entry in manifest.get(section, [])
]
assert commands, "manifest declares no commands"
for command in commands:
    assert command[0] == node, (command, node)
assert open(f"{root}/bin/configure.js", encoding="utf-8").readline().strip() == f"#!{node}", "configure.js shebang is not pinned"
print(f"ok: manifest {manifest['id']} {manifest['version']}, {len(commands)} commands and configure.js shebang use the pinned Node")
PY

# Read-only plugin root: nothing a command does can write into the store.
[ ! -w "$root" ] || { echo "FAIL: plugin root is writable: $root" >&2; exit 1; }
before=$(find "$root" | sort)

expected_state="$XDG_STATE_HOME/herdr/plugins/hhdebb.herdr-radar"

# 1. The install hook's report — a plain read that says it writes nothing.
"$node" "$root/bin/setup.js" > "$tmp/setup.out"
grep -q 'nothing was written' "$tmp/setup.out" || { echo "FAIL: setup.js did not report a no-write install" >&2; exit 1; }
echo "ok: status: setup.js reports that an install writes nothing"

# 2. Status.
"$node" "$root/bin/configure.js" --check > "$tmp/check.out"
grep -Fq "$expected_state" "$tmp/check.out" || { echo "FAIL: configure --check did not name the state dir" >&2; exit 1; }
echo "ok: status: configure --check names $expected_state"

# 3. Pure export for a generated config: a complete TOML document whose tab-bar
#    command reads this machine's state file, and no config on disk.
"$node" "$root/bin/configure.js" --print --variant dark > "$tmp/blocks.toml"
python3 - "$tmp/blocks.toml" "$expected_state" <<'PY'
import sys
import tomllib

doc = tomllib.load(open(sys.argv[1], "rb"))
state = sys.argv[2]
assert "ui" in doc, "export declares no [ui]"
assert doc["theme"]["custom"], "export carries no [theme.custom]"
entry = doc["ui"]["tab_bar_right"][0]
assert entry["command"] == f'cat "{state}/tabbar.txt"', entry
print(f"ok: export parses and points at {state}")
PY

# 4. Herdr injects the state dir; the export must follow it, not the HOME default.
injected="$tmp/injected/plugins/hhdebb.herdr-radar"
HERDR_PLUGIN_STATE_DIR="$injected" "$node" "$root/bin/configure.js" --print > "$tmp/blocks-injected.toml"
python3 - "$tmp/blocks-injected.toml" "$injected" <<'PY'
import sys
import tomllib

doc = tomllib.load(open(sys.argv[1], "rb"))
entry = doc["ui"]["tab_bar_right"][0]
assert entry["command"] == f'cat "{sys.argv[2]}/tabbar.txt"', entry
print(f"ok: export follows HERDR_PLUGIN_STATE_DIR ({sys.argv[2]})")
PY

# Anchor hooks are inert by default even in an immutable package, without a
# server, plugin settings or an event payload.
"$node" "$root/bin/anchors.js" --created > "$tmp/anchors.out"
test ! -s "$tmp/anchors.out"
echo "ok: disabled anchor hook needs no server and writes nothing"

# 5. Nothing was written outside the state directory the runtime owns, and the
#    read-only plugin root is untouched.
if [ -e "$XDG_CONFIG_HOME/herdr/config.toml" ]; then echo "FAIL: wrote Herdr config" >&2; exit 1; fi
if [ -e "$HOME/.config/herdr/config.toml" ]; then echo "FAIL: wrote Herdr config under HOME" >&2; exit 1; fi
after=$(find "$root" | sort)
[ "$before" = "$after" ] || { echo "FAIL: the plugin root changed" >&2; exit 1; }
echo "ok: immutable: plugin root unchanged, no Herdr config written"

echo "all package smoke checks passed"
