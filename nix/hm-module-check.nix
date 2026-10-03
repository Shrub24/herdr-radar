# Evaluates the Home Manager module against stubs of the three Home Manager
# options it sets, and checks what it would write. Home Manager itself is not an
# input of this flake, so `lib.hm.dag.entryAfter` is stubbed the same way.
{
  lib,
  pkgs,
  runCommand,
  writeShellScriptBin,
  self,
}:

let
  system = pkgs.stdenv.hostPlatform.system;
  plugin = self.packages.${system}.default;
  anchor = self.packages.${system}.herdr-anchor;
  herdr = writeShellScriptBin "herdr" "";

  libWithHm = lib.extend (
    _: _: {
      hm.dag.entryAfter = after: data: { inherit after data; };
    }
  );

  evalWith =
    settings:
    (lib.evalModules {
      specialArgs = {
        inherit pkgs;
        lib = libWithHm;
      };
      modules = [
        (import ./hm-module.nix { inherit self; })
        {
          options = {
            home.activation = lib.mkOption {
              type = lib.types.attrsOf lib.types.raw;
              default = { };
            };
            home.packages = lib.mkOption {
              type = lib.types.listOf lib.types.package;
              default = [ ];
            };
            xdg.configFile = lib.mkOption {
              type = lib.types.attrsOf lib.types.raw;
              default = { };
            };
          };
        }
        {
          programs.herdr-radar = {
            enable = true;
            herdrPackage = herdr;
          }
          // settings;
        }
      ];
    }).config;

  plain = evalWith { };
  full = evalWith {
    herdrPlus = {
      enable = true;
      wildcardWorktreeLayout = true;
      anchorCommand = "yazi";
    };
  };
  anchored = evalWith {
    anchor.enable = false;
    settings.anchors = {
      auto_create = true;
      command = "nvim";
    };
  };
  off = evalWith {
    enable = false;
    settings.anchors.auto_create = true;
  };

  # Compared as plain strings: a string that carries store path context cannot be
  # pattern-matched at evaluation time.
  strip = builtins.unsafeDiscardStringContext;
  link = strip plain.home.activation.linkHerdrRadar.data;
in
assert lib.assertMsg (lib.hasInfix "plugin link ${strip plugin} --enabled" link)
  "activation does not link the plugin: ${link}";
assert lib.assertMsg (
  plain.home.activation.linkHerdrRadar.after == [ "writeBoundary" ]
) "link runs before the boundary";
assert lib.assertMsg (
  plain.home.packages == [ anchor ]
) "the anchor wrapper is not on PATH by default";
assert lib.assertMsg (
  plain.xdg.configFile == { }
) "herdr-plus files are written without herdrPlus.enable";
assert lib.assertMsg (
  lib.attrNames full.xdg.configFile == [
    "herdr/plugins/config/cloudmanic.herdr-plus/projects/anchored.toml"
    "herdr/plugins/config/cloudmanic.herdr-plus/worktrees/anchored.toml"
  ]
) "unexpected herdr-plus files: ${toString (lib.attrNames full.xdg.configFile)}";
assert lib.assertMsg (
  anchored.home.packages == [ ]
) "automation unnecessarily requires the manual wrapper";
assert lib.assertMsg (
  lib.attrNames anchored.xdg.configFile == [
    "herdr/plugins/config/hhdebb.herdr-radar/config.toml"
  ]
) "anchor settings require herdr-plus or write unexpected files";
assert lib.assertMsg (
  off.home.packages == [ ] && off.home.activation == { } && off.xdg.configFile == { }
) "a disabled module still acts";

runCommand "herdr-radar-hm-module-check" { } ''
  project=${
    full.xdg.configFile."herdr/plugins/config/cloudmanic.herdr-plus/projects/anchored.toml".source
  }
  layout=${
    full.xdg.configFile."herdr/plugins/config/cloudmanic.herdr-plus/worktrees/anchored.toml".source
  }

  grep -qF 'command = "herdr-anchor -- yazi"' "$project"
  grep -qF 'command = "pi"' "$project"
  grep -qF 'repo = "*"' "$layout"
  grep -qF 'command = "herdr-anchor -- yazi"' "$layout"

  # Exactly one anchor per workspace: a second one is a second Agents entry.
  test "$(grep -c 'herdr-anchor' "$project")" = 1

  settings=${anchored.xdg.configFile."herdr/plugins/config/hhdebb.herdr-radar/config.toml".source}
  grep -qF 'auto_create = true' "$settings"
  grep -qF 'command = "nvim"' "$settings"

  touch $out
''
