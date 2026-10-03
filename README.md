<div align="center">

# herdr-radar

**See every agent at a glance**

<img src="assets/banner.webp" alt="herdr-radar — see every agent at a glance" width="100%">

<a href="https://github.com/hhdebb/herdr-radar/releases"><img src="https://img.shields.io/github/v/release/hhdebb/herdr-radar?style=flat-square&color=0797ff" alt="Latest release"></a>
<a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A5%2018-0797ff?style=flat-square" alt="Node 18+"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0797ff?style=flat-square" alt="MIT"></a>

<b>English</b> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a>

</div>

---

## What it is

A [Herdr](https://herdr.dev) plugin that turns the sidebar's Agents list into something you
can read: who is working, who is waiting on you, who has been parked for two hours — without
opening each one. It takes effect on install, writes only the display tokens the sidebar
shows, and never touches the agents themselves or your pane names.

## Why

With a dozen coding agents open, Herdr's own Agents list does not help: every session is a
line of the same grey text, `done` collapses into `idle` within seconds, and the one asking
you a question looks exactly like the one abandoned last Tuesday. You end up switching into
each pane to find out.

herdr-radar puts that information on the sidebar: a finished session keeps its tick until you
have looked, a question keeps its mark until you answer, sessions that have gone quiet fade,
sessions of one project sit under one header, and the busiest project sits on top.

## What you get

<img src="assets/sidebar.webp" alt="herdr-radar sidebar on a light and a dark desktop: groups, state marks, activity order" width="100%">

- **State does not slip away.** The tick stays until you focus the pane, the question mark
  stays until the agent works again, idle splits into three tiers by time since the last
  turn, and abandoned sessions dim as a whole row.
- **The list has structure.** Workspaces get headers, git worktrees hang under their repository
  as a tree, the panes of a split screen stay together, the busiest project sorts first, and
  the Spaces column takes the same colours.
- **The surroundings follow.** The tab bar shows the current directory, the managed theme block
  is generated for the desktop's light or dark when the `theme-sync` action runs, and one
  settings popup holds every option.

## Quick start

```sh
herdr plugin install hhdebb/herdr-radar
```

That is the whole install, and it changes nothing of yours: the plugin does not write Herdr's
`config.toml`, your terminal configs or your font directory on its own. Two actions do that,
when you ask for them — and they are also what repairs or redoes those files later:

```sh
herdr plugin action invoke hhdebb.herdr-radar.install-font   # the icon font, and the codepoint map
herdr plugin action invoke hhdebb.herdr-radar.configure      # the managed blocks in Herdr's config.toml
```

That order is the one to keep: the sidebar block writes the glyph table for the font it can see,
so a `configure` that runs before `install-font` writes the plain-Unicode rows. If you ran it in
that order, run `configure` once more afterwards.

`configure` writes three blocks into `config.toml`, each fenced by marker comments with nothing
outside them touched. `install-font` copies the font into your user font directory (no admin
rights needed) and maps its codepoints in the Ghostty / kitty configs that exist. A third,
optional action — `theme-sync` — regenerates the two colour-carrying blocks for the desktop's
current light or dark, when you have flipped it.

For a configuration you generate instead of edit — Nix, Home Manager, a dotfiles repository —
`node bin/configure.js --print` prints those blocks as one complete TOML document and writes
nothing at all (see *Declarative configs* below).

> [!IMPORTANT]
> Herdr starts plugins from its server at startup. If the sidebar has not changed after
> installing, start the daemon once:
> `herdr plugin action invoke hhdebb.herdr-radar.state-start`.
> Restarting Herdr (`herdr server stop`, then `herdr`) works too, but it ends every process in
> every pane. New terminal windows pick up the font; some terminals need a full restart.

> [!NOTE]
> Requires Herdr 0.9.0+ and Node 18+. Tested on Windows 11 and macOS; Linux not yet.
> Terminals without a codepoint map (Windows Terminal, iTerm) and the tab bar not following
> `cd` on Windows are covered under *Troubleshooting*.

Two keys, optional — paste into `config.toml`. Both go through Herdr's prefix (`ctrl+b` by
default), so they cannot collide with anything running inside a pane:

```toml
[[keys.command]]
key = "prefix+a"
type = "plugin_action"
command = "hhdebb.herdr-radar.view-flip"       # order: active <-> recent

[[keys.command]]
key = "prefix+comma"
type = "plugin_action"
command = "hhdebb.herdr-radar.settings"        # settings popup
```

From a checkout instead of GitHub:

```sh
git clone https://github.com/hhdebb/herdr-radar.git
herdr plugin link ./herdr-radar
herdr plugin action invoke hhdebb.herdr-radar.state-start
```

`plugin link` runs no build step; the third line starts the daemon, and the two actions above
are what write the managed blocks and the font, when you want them.

### Nix

`package.nix` builds the plugin as a Nix package whose output **is the plugin root** — the
directory `herdr-plugin.toml` sits in, which is what `herdr plugin link` registers:

```sh
nix-build -E 'with import <nixpkgs> {}; callPackage ./package.nix {}'
herdr plugin link ./result
```

The built manifest is rewritten so every command runs the packaged Node interpreter by absolute
path — nothing has to be on Herdr's `PATH` for the plugin to start. `plugin link` runs no build
hook and the store is left alone: the plugin keeps its state under `HERDR_PLUGIN_STATE_DIR` and
its settings under `HERDR_PLUGIN_CONFIG_DIR`, both outside the store. Relink after a rebuild —
`./result` is a symlink, and Herdr stores the path it was linked with.

Because the configuration is generated, take the blocks from the pure export rather than the
`configure` action. The packaged scripts are executable and run the pinned Node themselves:

```sh
plugin=$(nix-build -E 'with import <nixpkgs> {}; callPackage ./package.nix {}' --no-out-link)
"$plugin/bin/configure.js" --print --variant dark > herdr-radar.toml
```

`package.nix` also carries a smoke check for the package — a read-only install and status, the
pure export, and the state path it points at:

```sh
nix-build -E 'with import <nixpkgs> {}; callPackage ./package.nix {}' -A tests.smoke
```

As a flake, it exposes `packages.default` (the plugin root), `packages.herdr-anchor`, the checks
(`nix flake check`) and a Home Manager module. `herdr plugin link` is the only way Herdr learns
of a plugin, and its registry is mutable state, so the module links on every activation:

```nix
{
  imports = [ inputs.herdr-radar.homeManagerModules.default ];
  programs.herdr-radar = {
    enable = true; # links the plugin; never writes Herdr's config.toml
    settings.anchors.auto_create = true; # anchor every new workspace; no herdr-plus needed
  };
}
```

The plugin starts when the server restores its session, or run the `state-start` action once.
Radar settings are written to its own plugin config, not Herdr's `config.toml`. Anchor creation
is opt-in; omit `settings` to leave all files and workspace layouts alone. The optional
`herdrPlus` templates remain available for project/worktree layouts, but anchors do not depend
on them.

### Or hand it to an agent

Paste this at a coding agent and it will do the install:

```text
Install the herdr-radar plugin for Herdr on this machine.

1. herdr plugin install hhdebb/herdr-radar
2. herdr plugin action invoke hhdebb.herdr-radar.state-start
3. herdr plugin action invoke hhdebb.herdr-radar.install-font
4. herdr plugin action invoke hhdebb.herdr-radar.configure
5. Check it took: `herdr plugin list` shows hhdebb.herdr-radar as enabled, and
   `herdr agent list` shows a `sort_key` token on the panes that run an agent
   (that one is written whatever state a pane is in; the logo token's name
   changes with the state).

Do NOT run `herdr server stop`, and do not kill the Herdr process. That ends
every program in every pane, including whatever is running you. Nothing here
needs a restart. The install itself writes nothing: step 3 installs the font and
step 4 writes the managed blocks into Herdr's `config.toml`, and new terminal
windows pick up the icon font on their own. Keep that order — the sidebar block
writes the glyph table for the font it can see, so a `configure` that ran before
the font is in has to be run again afterwards. Skip 3 and 4 if this machine's
configuration is generated (Nix, Home Manager, a dotfiles repo) — get the blocks
from `node bin/configure.js --print` instead.

Needs Herdr 0.9.0 or newer and Node 18 or newer. If the marks come out as
boxes, the terminal has no codepoint map for them — that case and the rest are
covered under Troubleshooting at https://github.com/hhdebb/herdr-radar
```

## What the sidebar looks like

```
dashboard
  ⣟ ✳ Implement OAuth scopes            ← working: braille spinner, title in the vendor's colour
  ✓ ✳ Wire retry budget into dispatcher ← done: green tick, held until you look
  └─  feature/mc-13200                  ← a worktree under its repository
    ? Λ Which env file should I edit?   ← blocked: a pulsing red mark, it is asking you
billing
  ✳ Trace duplicate charges             ← idle: just stopped
  ✳ Migrate invoices table              ← idle for two hours: the whole row dims
```

One row per agent: logo, title, colour by state, motion and marks in front of the title. Two
orders: `active` keeps the groups and ranks by activity at both levels; `recent` is a flat
list by activity — `prefix+a` flips between them. The whole panel can be handed back to
Herdr's own rendering from the settings popup.

### A workspace's anchor pane

A pane that reports itself as an agent and carries the pane token `anchor` is its
workspace's anchor. It is drawn as the group header and as nothing else: no agent row, no
say in the workspace's colour, mark or logos, and it sorts first in its workspace. A
workspace with nothing but its anchor is still listed, as a dimmed heading. Workspaces
without an anchor are drawn as before. Only the first anchor in a workspace is its header,
and the header reads as one only where the anchor is the first row of its group: Radar's
own views guarantee that, Herdr's priority order does not.

Radar can create these anchors itself, for ordinary workspaces as well as worktrees. No
herdr-plus template is needed. In Radar's settings popup, enable `anchors.auto_create`, or
put this in `~/.config/herdr/plugins/config/hhdebb.herdr-radar/config.toml`:

```toml
[anchors]
auto_create = true
command = "" # interactive shell; use "nvim", "jjui" or "yazi" for a management surface
```

Each newly created workspace gets one background `anchor` tab in its active pane's working
directory. Focus stays where it was. The tab launches Radar's own entrypoint, which starts
the management command and reports the workspace name once in `idle`. Existing panes are
never reused or sent commands. A workspace that already has an anchor — manually reported
or supplied by a template — is skipped.

Enabling this does not retrofit restored or already-open workspaces. Add their missing anchors
explicitly, once, with:

```sh
herdr plugin action invoke hhdebb.herdr-radar.anchors-all
```

The action works even with automatic creation off and skips existing anchors. Changing
`command` affects only future anchors. Closing an anchor does not trigger an automatic
respawn; invoke the action again when you want a replacement. Do not run a real agent in
the anchor's pane: Herdr has one agent entry per pane.

Creation is serialized per workspace. If a creation receipt is lost or an entrypoint fails
before reporting, Radar keeps a reservation under its state directory's `anchors/` and
refuses to create another tab blindly. The error names the file to inspect: first check
whether the tab exists, then remove the reservation only if it is safe to retry. A lock
left by a killed hook likewise needs explicit inspection. This is runtime state, never a
write to Herdr or terminal configuration.

## What the colours mean

Two things are worth knowing about a row at a glance, and they are carried separately: the
**logo** says whose agent it is, the **title** says what that agent is doing. Neither reading
depends on the other.

The logo wears the vendor's own colour, and only ever the one the vendor publishes. A brand
that signs itself in black or white has no hue to borrow, so its mark is simply drawn in ink —
black on a light panel, white on a dark one — rather than in a colour this project invented for
it. Nothing about a row's state changes the logo.

The title carries the state, and shape carries it too, so the panel still reads without colour:

| State | Title | In front of it |
| --- | --- | --- |
| working | the vendor's colour | a braille spinner, turning |
| waiting on you | red | a question mark, pulsing |
| done | green | a tick, held until you focus the pane |
| idle | the freshness scale, below | a ring |
| unknown | violet | a ring |

Green and red are semantic and outrank branding: they are there to pull the eye, so no vendor
colour is allowed to be either. A working title takes its vendor's hue rather than one shared
"busy" colour because with thirty rows on screen the hue is what separates one running session
from the next before any of them is read.

**Idle is a gradient, not a state.** Once an agent stops, the only question left is how long
ago, so the title cools with the time since its last turn: the first 15 minutes read as just
stopped, then plain text out to two hours, after which the whole row dims — logo, marks and all
— and sinks to the bottom of its group. Both thresholds are settings
(`activity_fresh_minutes`, `activity_stale_minutes`). All three tiers draw the same ring, and
colour alone says which one: a mark that changed shape as it aged would have to be learned
three times.

A pane that was already open before this plugin started has no stamp of its own, so its last
turn is recovered from the session's own record where the CLI keeps one — Claude's and Codex's
transcripts, and for Kilo Code the session's own `time_updated` row in `~/.local/share/kilo/kilo.db`.
That last one needs a Node whose built-in `node:sqlite` really opens a store read-only — 22.12
or newer, 23.2 or newer on the 23 line; on an older runtime the pane reads as plain idle, which is
the answer for an agent whose record cannot be followed. The store is opened read-only and only its own row is read: a
store-wide timestamp is not used, because it would shade a stale pane fresh whenever a different
Kilo pane happened to be busy.

The Spaces column takes the same vendor colours, so a workspace running Claude and one running
Gemini are told apart there too.

## Which agents it knows

Twenty-seven vendors have a mark of their own:

<!-- prettier-ignore -->
| | | | |
| --- | --- | --- | --- |
| <img src="assets/marks/amp.svg" width="15" align="top"> Amp | <img src="assets/marks/agy.svg" width="15" align="top"> Antigravity | <img src="assets/marks/claude.svg" width="15" align="top"> Claude Code | <img src="assets/marks/cline.svg" width="15" align="top"> Cline |
| <img src="assets/marks/codex.svg" width="15" align="top"> Codex | <img src="assets/marks/copilot.svg" width="15" align="top"> Copilot | <img src="assets/marks/crush.svg" width="15" align="top"> Crush | <img src="assets/marks/cursor.svg" width="15" align="top"> Cursor |
| <img src="assets/marks/deepseek.svg" width="15" align="top"> DeepSeek | <img src="assets/marks/devin.svg" width="15" align="top"> Devin | <img src="assets/marks/gemini.svg" width="15" align="top"> Gemini | <img src="assets/marks/glm.svg" width="15" align="top"> GLM |
| <img src="assets/marks/gpt.svg" width="15" align="top"> GPT | <img src="assets/marks/grok.svg" width="15" align="top"> Grok | <img src="assets/marks/hermes.svg" width="15" align="top"> Hermes | <img src="assets/marks/kilo.svg" width="15" align="top"> Kilo |
| <img src="assets/marks/kimchi.svg" width="15" align="top"> Kimchi | <img src="assets/marks/kimi.svg" width="15" align="top"> Kimi | <img src="assets/marks/kiro.svg" width="15" align="top"> Kiro | <img src="assets/marks/maki.svg" width="15" align="top"> Maki |
| <img src="assets/marks/mastracode.svg" width="15" align="top"> Mastra | <img src="assets/marks/muse.svg" width="15" align="top"> Muse | <img src="assets/marks/omp.svg" width="15" align="top"> Oh My Pi | <img src="assets/marks/opencode.svg" width="15" align="top"> OpenCode |
| <img src="assets/marks/pi.svg" width="15" align="top"> Pi | <img src="assets/marks/qodercli.svg" width="15" align="top"> Qoder | <img src="assets/marks/qwen.svg" width="15" align="top"> Qwen | |

Herdr detects two more — Droid and Letta — and neither publishes a mark this project can use.
Those rows behave like any other — state, colour, ordering, grouping — they just wear the
generic mark instead of one of their own. A pull request adding either is welcome; the marks
for Antigravity and Kiro arrived that way.

Anything else Herdr recognises is shown the same way: the generic mark, a colour of its own,
and everything else intact.

### When the process name is not the vendor

A GLM session runs the stock `claude` binary against an Anthropic-compatible endpoint, so
Herdr detects `claude` — correctly, and always will. The same is true of any wrapper around
a known binary. Detection cannot see through that, and neither can this plugin: what the
pane is doing is known only to whoever started it.

So let the wrapper say so. Herdr keeps a display-only field for exactly this, and one line
before the `exec` fills it in:

```sh
herdr pane report-metadata "$HERDR_PANE_ID" --source user:cglm --display-agent glm
exec claude "$@"
```

The row then wears the GLM mark and name. `--clear-display-agent` takes it back. A value
this plugin does not recognise is ignored rather than blanking the row, so a human label
such as `Claude: auth` still leaves the Claude mark in place.

## Settings

`prefix+,` opens the settings popup: `↑↓` select, `←→` change, `↵` edit a text value, `r`
reset to default, `s` save and apply, `q` close. Saving rewrites only the changed lines of
the config file and restarts the daemon.

| Option | Default | Does |
| --- | --- | --- |
| `agents_panel` | `plugin` | this plugin's panel, or `herdr` for Herdr's own |
| `order` | `active` | `active` grouped by activity / `recent` flat / `off` Herdr's order |
| `variant` | `auto` | logos from the icon font (`font`), plain Unicode (`text`), or `none`; `auto` recognises the font the plugin installed |
| `done_hold` | `until_seen` | keep the tick until the pane is focused, or a number of seconds |
| `blocked_hold` | `true` | keep the question mark until the agent works again |
| `idle_grace_seconds` | `2.5` | idle must persist this long to count as a finished turn |
| `activity_fresh_minutes` | `15` | how long after the last turn a pane still reads as fresh |
| `activity_stale_minutes` | `120` | how long without a turn before the row dims |
| `group_indent` | `2` | member indent under a header; `0` for a flat list |
| `group_gap` | `true` | a blank row between groups |
| `split_corner` | `false` | hang the other panes of a split screen off the first with a `├─` corner |
| `reorder_workspaces` | `false` | make Herdr's workspace indices follow Radar's activity order |
| `row_label` | `title` | what names an agent row: `title`, `tab` (the tab's name) or `both`; replaces `show_tab` |
| `trim_group_prefix` | `true` | drop the workspace name from a title when the header above already shows it |
| `worktree_mark` | `U+F418` | the mark on a worktree header, needs a Nerd Font; empty for none |
| `follow_appearance` | `true` | with it on, the desktop's light/dark decides the theme block when `configure` or `theme-sync` runs; with it off, `configure` follows the config's own `[theme] name` and `theme-sync` does nothing unless it is passed `--force` |
| `colors.active_row_bg_light` | `#b9cdf2` | selected-row fill for a light theme; empty keeps the theme's own |
| `colors.active_row_bg_dark` | `#414868` | selected-row fill for a dark theme |

`row_label` picks what names an agent row. `title` is the session's own title,
`tab` is the name of the tab it runs in, and `both` puts the tab name in front of
the title — what `show_tab = true` did, which still reads as `both`. Pick `tab`
when you name tabs after their sessions, so the name is not written twice. A
tab-only row keeps its title when the tab was never named (Herdr labels such a
tab with its number).

Set `reorder_workspaces = true` to make Herdr's actual workspace order follow Radar's
most-active-first order, so the Spaces list reads in the same order as the Agents panel and
the indexed jump lands on the row you are looking at. Worktree families stay together;
workspaces with nothing running keep their relative order at the end, and the reorder stops
while the panel is handed back to Herdr's own order. It is off by default because it changes
the global Spaces order, which every connected client sees, and because the order then moves
as you work — the number that reaches a project today is not the one that reaches it tomorrow.

Herdr leaves the workspace jump **unbound by default** — `switch_tab` ships as `prefix+1..9`,
the workspace one does not ship at all — so bind it before expecting the keys to do anything:

```toml
[keys]
switch_workspace = "prefix+shift+1..9"
```

The first two are live state; the rest live in
`$(herdr plugin config-dir hhdebb.herdr-radar)/config.toml` and can be edited by hand —
then `state-stop` and `state-start`. The file appears the first time the popup saves; before
that, create it with the keys above (booleans unquoted: `group_gap = false`).

Both this file and Herdr's `config.toml` can be symlinks into a dotfiles repository: the
popup and `configure` write through the link to its target, so the link stays in place. (A
link whose target is missing is written over, as a plain file.) That is for a target you can
write. For one you cannot — a Nix store path, a file Home Manager generates — see below.

### Declarative configs

An install, a daemon start and a daemon tick write nothing of yours, so a machine whose
configuration is generated never has to fight the plugin for the file. What you need is the
blocks, to put in the config you generate:

```sh
node bin/configure.js --print                     # the blocks, as one TOML document
node bin/configure.js --print --variant dark      # ... generated for a pinned appearance
```

The command reads and writes nothing, spawns nothing, and asks neither Herdr nor your desktop
anything, so it works with Herdr not running. `--variant` pins the appearance; without it, the
appearance comes from the `[theme] name` already in the config you are generating, and the glyph
table from the plugin's own `variant` setting — set `variant = "font"` there if you install the
font declaratively, since the plugin's `auto` cannot see a font it did not install itself. The
document declares `[ui]` for the tab-bar keys, the `[theme.custom]` block and the
`[ui.sidebar.*]` rows; merge the tab-bar keys into your own `[ui]` table rather than declaring
it twice. One thing in it is machine-specific on purpose: the tab-bar entry is a command that
reads this plugin's state file, so the document carries the selected absolute state path (and
the `cat`/`type` that suits the platform), and is generated the same way twice on one machine
rather than byte-identical between two.

#### Keeping your own theme

A config that owns its theme — `[theme] name = "terminal"` and its own `[theme.custom]` — asks
for the document without the theme table, and pins the appearance, since a terminal theme names
no side for the colours to follow:

```sh
node bin/configure.js --print --variant dark --blocks tabbar,sidebar
```

`--blocks` takes any of `tabbar`, `theme` and `sidebar`, comma-separated; the default is all
three, and the order they are named in does not move them. `[ui]` is declared only when `tabbar`
is in the document (the sidebar tables are `[ui.sidebar.*]` and stand alone), so a seed that
already has a `[ui]` merges the tab-bar keys into it. A name that is not one of the three fails
before anything is printed. Without `--variant` and with no named theme the colours are generated
for light, and stderr says so.

The dark seed is only the starting point. To follow the desktop afterwards, run
`herdr plugin action invoke hhdebb.herdr-radar.theme-sync` once after login and again whenever
the appearance changes (on Linux, a user unit around
`gsettings monitor org.gnome.desktop.interface color-scheme` does it). With `terminal` as the
theme the refresh rewrites only the plugin's own sidebar block: `[theme]` (`name` and
`auto_switch`), your `[theme.custom]` and everything outside the markers are left byte-identical,
and nothing is recorded for `--uninstall` to restore. A named Herdr theme is still driven from
`light_name` and `dark_name`, as before.

Because the refresh edits the sidebar block inside `config.toml`, that file must be a writable
copy seeded at activation, not a read-only symlink into the store — and the seed must contain the
marker-fenced sidebar block for the refresh to find. A static, read-only config works too, but
then the colours stay as seeded.

## Troubleshooting

Start with `herdr plugin log list --plugin hhdebb.herdr-radar --limit 20`: every plugin command
leaves its output and errors there.

<details>
<summary><b>Font installed, logos still show as boxes or question marks</b></summary>

The terminal has not reloaded its fonts. Open a new window; if that is not enough, quit the
terminal and reopen it. macOS keeps an extra cache: `killall fontd fontworker`, then reopen.
</details>

<details>
<summary><b>A logo renders as a random CJK character</b></summary>

Another font claimed the same Private Use Area — CJK fonts often do. The terminal must map the
codepoints to `Herdr Agent Icons Max`; adding it as a fallback family is not enough. Ghostty /
kitty: `herdr plugin action invoke hhdebb.herdr-radar.install-font` writes the map. Other
terminals: map `U+E1A0–U+E1BA` and `U+E1C0–U+E1C5` by hand. Terminals with no codepoint map
(Windows Terminal, iTerm): use `dist/JetBrainsMonoHerdr-Regular.ttf` as the terminal font —
JetBrains Mono with the icons patched in.

On Ghostty, `ghostty +show-face` is the only command that says whether the map resolved;
`+show-config` and `+list-fonts` pass either way. The map written by v1.3.7 and earlier was
inert — it quoted the family name, so run the install action once more.
</details>

<details>
<summary><b>Nothing changed after installing</b></summary>

The daemon is not running: `herdr plugin action invoke hhdebb.herdr-radar.state-start`. If it
still does not, read that command's output in the plugin log
(`herdr plugin log list --plugin hhdebb.herdr-radar --limit 20`). The usual causes: the
`configure` action was never run — an install writes nothing to your `config.toml`; no
Node 18+ on the PATH Herdr sees; no `[ui]` table in `config.toml` for the managed block to
attach to. A table the plugin writes that is already in your file is not one: see the next entry.
</details>

<details>
<summary><b>A toast says a block was skipped, or <code>configure failed (exit 1)</code></b></summary>

Your `config.toml` already has a `[theme.custom]` or `[ui.sidebar.*]` table — as a header, a
dotted key (`custom.name = …` under `[theme]`) or an inline table. The plugin writes those
tables itself, and TOML allows each table once, so the block that would collide stays out and
the rest installs: without the sidebar block the Agents panel is Herdr's own; without the theme
block your theme keeps its colours. To have the plugin's, delete your table and run the
configure action again, then put any keys the block does not set back inside it. Older
versions refused the whole install instead, with the reason only in the plugin log
(`herdr plugin log list --plugin hhdebb.herdr-radar --limit 20`).
</details>

<details>
<summary><b>Changed a setting, nothing happened</b></summary>

The daemon reads its config at start. `s` in the settings popup restarts it; after a hand edit,
`state-stop` then `state-start`. Editing the three managed blocks in `config.toml` directly
does not stick — the next `configure` (or `theme-sync`) writes them back.
</details>

<details>
<summary><b>The tab bar path disappeared, or shows in one workspace only</b></summary>

Herdr drops the whole status area when it is one column too wide rather than truncating it.
Lower the `HERDR_RADAR_TABBAR_MAX` environment variable (default 48) or narrow the sidebar. Or
Herdr's client and server versions differ (`restart_needed: yes` in `herdr status`):
`herdr server stop` and reopen.
</details>

<details>
<summary><b>On Windows the tab bar shows the directory a pane started in</b></summary>

Herdr cannot follow `cd` on Windows. Source `shell/herdr-osc7.zsh` / `.bash` from your
`~/.zshrc` or `~/.bashrc` so the shell reports it; applies to panes opened afterwards.
</details>

<details>
<summary><b>The settings popup closes at once</b></summary>

On Windows, `herdr plugin pane open` needs `--cwd <plugin directory>`; without it Herdr hands
the pane an extended-length path Git Bash cannot enter. The bound `prefix+,` already passes it.
</details>

<details>
<summary><b>The agent is asking me something, but there is no question mark</b></summary>

The plugin does no detection of its own; it mirrors Herdr's verdict. Herdr recognises
`blocked` from the shape of the dialog on screen and treats anything it does not recognise as
idle. `herdr agent explain <pane> --verbose` shows which rules matched.
</details>

## Uninstall

In this order — `unconfigure` stops the daemon, clears every token it wrote and removes the
managed blocks, and it needs the plugin still installed to be invoked at all:

```sh
herdr plugin action invoke hhdebb.herdr-radar.unconfigure
herdr plugin action invoke hhdebb.herdr-radar.uninstall-font
herdr plugin uninstall hhdebb.herdr-radar
```

What stays is the state directory with its config backups,
`~/.local/state/herdr/plugins/hhdebb.herdr-radar` (`%LOCALAPPDATA%\herdr\plugins\...` on
Windows); delete it by hand if you want nothing left.

## How it works

One resident daemon, woken by Herdr's event stream, takes a snapshot from `herdr agent list`
each frame and writes only states, groups and sort keys as sidebar tokens. It writes nothing
of yours while it runs: the managed blocks belong to the `configure` and `theme-sync` actions,
and the font to `install-font`. No network; outside Herdr's config and its own state directory
it reads one thing, a session's own record — the tail of its transcript, or for Kilo Code its
row in Kilo's store — to give panes older than the plugin a last-activity time. Like every
Herdr plugin it runs as your user and Herdr does not sandbox it — read `herdr-plugin.toml` and
`bin/` before installing if that matters to you.

## License and credits

MIT, see [LICENSE](LICENSE). Forked from [qintmb/herdr-icon-agent-ui](https://github.com/qintmb/herdr-icon-agent-ui),
which contributed the icon font and the one-codepoint-per-logo idea. Vendor marks in the font
belong to their owners; sources in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
`dist/JetBrainsMonoHerdr-Regular.ttf` is JetBrains Mono modified and renamed under the SIL OFL
1.1; the license text ships as `dist/OFL.txt`.
