#!/usr/bin/env node
'use strict';

// No startup reconciliation: existing workspaces are changed only by --all.
// The event path is inert unless [anchors] auto_create is explicitly true.
const ipc = require('../lib/ipc');
const config = require('../lib/config');
const { settings, createdWorkspace, ensureAnchor } = require('../lib/anchors');

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--created', '--all'].includes(args[0])) {
    console.error('usage: anchors.js --created | --all');
    process.exitCode = 2;
    return;
  }
  const options = settings(config.raw);
  let ids;
  if (args[0] === '--created') {
    if (!options.autoCreate) return;
    ids = [createdWorkspace(process.env.HERDR_PLUGIN_EVENT_JSON, process.env.HERDR_WORKSPACE_ID)];
  } else {
    const reply = await ipc.call('workspace.list', {});
    const workspaces = reply?.result?.workspaces;
    if (
      reply?.error ||
      !Array.isArray(workspaces) ||
      workspaces.some((w) => typeof w.workspace_id !== 'string' || !w.workspace_id)
    ) {
      throw new Error('could not read workspace inventory; no anchors created');
    }
    ids = workspaces.map((w) => w.workspace_id);
  }
  for (const id of ids) {
    try {
      const result = await ensureAnchor(id, options);
      console.log(`${id}: ${result.status}${result.paneId ? ` (${result.paneId})` : ''}`);
    } catch (error) {
      console.error(`${id}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
