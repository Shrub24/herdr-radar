'use strict';

// Workspace anchors belong to Radar, but creating panes is opt-in. This code
// never adopts an existing pane: it creates a background tab, then reports only
// its new root pane. An explicit retrofit action uses the same operation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ipc = require('./ipc');

const paths = require('./paths');

function settings(raw) {
  const value = raw.anchors ?? {};
  if (typeof value !== 'object' || value === null) throw new Error('[anchors] must be a table');
  if (value.auto_create !== undefined && typeof value.auto_create !== 'boolean') {
    throw new Error('anchors.auto_create must be true or false');
  }
  if (value.command !== undefined && typeof value.command !== 'string')
    throw new Error('anchors.command must be a string');
  return { autoCreate: value.auto_create === true, command: value.command ?? '' };
}

function createdWorkspace(text, context) {
  const event = JSON.parse(text ?? 'null');
  const id = event?.data?.workspace?.workspace_id;
  if (!['workspace_created', 'workspace.created'].includes(event?.event) || typeof id !== 'string' || !id) {
    throw new Error('expected a workspace.created event with a workspace id');
  }
  if (context && context !== id) throw new Error('workspace event and invocation context disagree');
  return id;
}

function checked(reply, operation) {
  if (!reply?.result || reply.error)
    throw new Error(`${operation} failed: ${reply?.error?.message ?? reply?.error?.code ?? 'no receipt'}`);
  return reply.result;
}

// Hook processes can overlap an explicit retrofit. Lock per session/workspace,
// not globally. A dead owner's lock needs explicit inspection, never a blind
// removal that could race a new owner.
function lock(dir) {
  try {
    fs.mkdirSync(dir);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner;
    try {
      owner = Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8'));
    } catch {
      return false;
    }
    if (!Number.isSafeInteger(owner) || owner <= 0) return false;
    try {
      process.kill(owner, 0);
      return false;
    } catch (error) {
      if (error.code !== 'ESRCH') return false;
    }
    // Do not race to remove a stale lock: a concurrent process might replace
    // it before our removal. Report it for explicit inspection instead.
    throw new Error(`stale anchor lock; inspect and remove ${dir} before retrying`);
  }
  fs.writeFileSync(path.join(dir, 'pid'), String(process.pid));
  return true;
}

async function ensureAnchor(workspaceId, options = {}, deps = {}) {
  const call = deps.call ?? ipc.call;
  const socket =
    deps.socket ?? process.env.HERDR_SOCKET_PATH ?? path.join(path.dirname(paths.herdrConfigPath()), 'herdr.sock');
  const key = crypto.createHash('sha256').update(`${socket}\0${workspaceId}`).digest('hex');
  const dir = path.join(deps.stateDir ?? paths.stateRoot, 'anchors');
  fs.mkdirSync(dir, { recursive: true });
  const busy = path.join(dir, `${key}.lock`);
  const pending = path.join(dir, `${key}.json`);
  if (!lock(busy)) return { status: 'busy', workspaceId };
  try {
    const { panes } = checked(await call('pane.list', { workspace_id: workspaceId }), 'pane inventory');
    if (!Array.isArray(panes)) throw new Error('pane inventory is malformed');
    const members = panes.filter((p) => p.workspace_id === workspaceId);
    if (members.some((p) => p.tokens?.anchor)) {
      fs.rmSync(pending, { force: true });
      return { status: 'exists', workspaceId };
    }
    if (fs.existsSync(pending)) {
      const reservation = JSON.parse(fs.readFileSync(pending, 'utf8'));
      // Never launch another tab while the first entrypoint may be starting.
      // A coherent inventory can prove a RECEIPTED pane has since closed; an
      // unreceipted creation still needs inspection before clearing its record.
      if (!reservation.paneId || members.some((p) => p.pane_id === reservation.paneId)) {
        throw new Error(`anchor creation pending or uncertain; inspect this workspace before removing ${pending}`);
      }
      fs.rmSync(pending);
    }

    const { workspace } = checked(await call('workspace.get', { workspace_id: workspaceId }), 'workspace lookup');
    if (workspace?.workspace_id !== workspaceId) throw new Error('workspace lookup is malformed');
    const active = members.filter((p) => p.tab_id === workspace.active_tab_id);
    const root = active.find((p) => p.focused) ?? active[0] ?? members[0];
    const cwd = root?.foreground_cwd ?? root?.cwd;
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd))
      throw new Error('workspace has no usable pane working directory');
    fs.writeFileSync(pending, JSON.stringify({ workspaceId }));
    const { layout } = checked(
      await call('layout.apply', {
        workspace_id: workspaceId,
        tab_label: 'anchor',
        focus: false,
        root: {
          type: 'pane',
          cwd,
          command: [process.execPath, path.join(__dirname, '..', 'bin', 'anchor-pane.js'), options.command ?? ''],
        },
      }),
      'anchor tab creation',
    );
    const paneId = layout?.root?.pane_id;
    if (layout?.workspace_id !== workspaceId || typeof paneId !== 'string' || !paneId) {
      throw new Error(`anchor creation receipt is malformed; inspect ${pending}`);
    }
    fs.writeFileSync(pending, JSON.stringify({ workspaceId, paneId }));
    return { status: 'created', workspaceId, paneId };
  } finally {
    fs.rmSync(busy, { recursive: true, force: true });
  }
}

// Called by the new pane's stable entrypoint, not by the workspace hook.
async function reportAnchor(paneId, workspaceId, call = ipc.call) {
  if (!paneId || !workspaceId) throw new Error('anchor entrypoint requires Herdr pane context');
  const { workspace } = checked(await call('workspace.get', { workspace_id: workspaceId }), 'workspace lookup');
  if (workspace?.workspace_id !== workspaceId) throw new Error('workspace lookup is malformed');
  checked(
    await call('pane.report_agent', {
      pane_id: paneId,
      source: 'anchor',
      agent: workspace.label || 'space',
      state: 'idle',
    }),
    'anchor report',
  );
  checked(
    await call('pane.report_metadata', {
      pane_id: paneId,
      source: 'anchor',
      tokens: { anchor: '1' },
    }),
    'anchor marker',
  );
}

module.exports = { settings, createdWorkspace, ensureAnchor, reportAnchor };
