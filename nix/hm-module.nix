# Home Manager module for Herdr Radar. `self` is this flake.
#
#   programs.herdr-radar.enable = true;
#
# Herdr keeps its plugin registry (~/.config/herdr/plugins.json) as mutable state
# and records the path it was linked with, so the link cannot be a file: it is
# refreshed on every activation. `plugin link` runs no build hook and is
# idempotent. It does not start the plugin; a running server picks it up when it
# restores its session, or start the daemon once:
#   herdr plugin action invoke hhdebb.herdr-radar.state-start
#
# This module never writes Herdr's config.toml. Herdr saves settings into that
# file itself, which fails against a read-only store symlink; take the sidebar
# blocks from the pure export (`herdr-radar/bin/configure.js --print`) when the
# configuration is generated.
{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.herdr-radar;
  plus = cfg.herdrPlus;
  system = pkgs.stdenv.hostPlatform.system;
  toml = pkgs.formats.toml { };

  plusDir = "herdr/plugins/config/cloudmanic.herdr-plus";

  # One anchor per workspace: a second one is a second Agents entry, and an agent
  # started in the anchor's own pane would hide it. The anchor and the real agent
  # therefore live in different panes.
  tabs = [
    {
      name = "work";
      panes = [
        {
          label = "anchor";
          command = "herdr-anchor -- ${plus.anchorCommand}";
        }
        {
          label = "agent";
          command = plus.agentCommand;
          split = "right";
          ratio = 0.5;
        }
      ];
    }
    {
      name = "vcs";
      command = "jjui";
    }
  ];

  files =
    lib.mapAttrs' (
      name: value:
      lib.nameValuePair "${plusDir}/projects/${name}.toml" {
        source = toml.generate "herdr-plus-project-${name}.toml" value;
      }
    ) plus.projects
    // lib.mapAttrs' (
      name: value:
      lib.nameValuePair "${plusDir}/worktrees/${name}.toml" {
        source = toml.generate "herdr-plus-worktree-${name}.toml" value;
      }
    ) plus.worktrees;
in
{
  options.programs.herdr-radar = {
    enable = lib.mkEnableOption "Herdr Radar, linked into Herdr on activation";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${system}.default;
      defaultText = lib.literalExpression "herdr-radar.packages.\${system}.default";
      description = "The plugin root that `herdr plugin link` registers.";
    };

    herdrPackage = lib.mkOption {
      type = lib.types.package;
      default = pkgs.herdr;
      defaultText = lib.literalExpression "pkgs.herdr";
      description = "The Herdr whose registry the plugin is linked into.";
    };

    settings = lib.mkOption {
      type = toml.type;
      default = { };
      description = ''
        Radar's own config.toml settings. An empty value writes no file.
        Set anchors.auto_create = true to add an anchor to every new workspace;
        anchors.command selects its management command (empty means a shell).
        This does not write Herdr's config.toml or retrofit existing workspaces.
      '';
    };

    anchor = {
      enable = lib.mkEnableOption "the `herdr-anchor` wrapper on PATH" // {
        default = true;
      };
      package = lib.mkOption {
        type = lib.types.package;
        default = self.packages.${system}.herdr-anchor;
        defaultText = lib.literalExpression "herdr-radar.packages.\${system}.herdr-anchor";
        description = "The wrapper that declares a pane as its workspace's anchor entry.";
      };
    };

    herdrPlus = {
      enable = lib.mkEnableOption ''
        anchored workspace templates for herdr-plus, written under its plugin
        config directory. herdr-plus itself is not installed by this module'';

      anchorCommand = lib.mkOption {
        type = lib.types.str;
        default = "nvim";
        description = "What the anchor pane runs: a management surface such as nvim, jjui or yazi.";
      };

      agentCommand = lib.mkOption {
        type = lib.types.str;
        default = "pi";
        description = "What the agent pane beside the anchor runs.";
      };

      wildcardWorktreeLayout = lib.mkEnableOption ''
        a worktree layout for every repository, so each worktree workspace opens
        with an anchor. Worktrees never use a project template'';

      projects = lib.mkOption {
        type = lib.types.attrsOf toml.type;
        default = {
          anchored = {
            name = "Anchored workspace";
            description = "A management anchor pane, an agent beside it, and jjui";
            working_dir = "~";
            inherit tabs;
          };
        };
        defaultText = lib.literalExpression "{ anchored = { … }; }";
        description = "Project templates, one file each under `projects/`.";
      };

      worktrees = lib.mkOption {
        type = lib.types.attrsOf toml.type;
        default = lib.optionalAttrs plus.wildcardWorktreeLayout {
          anchored = {
            repo = "*";
            inherit tabs;
          };
        };
        defaultText = lib.literalExpression "{ } or one wildcard layout";
        description = "Worktree layouts, one file each under `worktrees/`.";
      };
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      {
        home.activation.linkHerdrRadar = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
          run ${cfg.herdrPackage}/bin/herdr plugin link ${cfg.package} --enabled
        '';
      }

      (lib.mkIf cfg.anchor.enable { home.packages = [ cfg.anchor.package ]; })

      (lib.mkIf (cfg.settings != { }) {
        xdg.configFile."herdr/plugins/config/hhdebb.herdr-radar/config.toml".source =
          toml.generate "herdr-radar-settings.toml" cfg.settings;
      })

      (lib.mkIf plus.enable { xdg.configFile = files; })
    ]
  );
}
