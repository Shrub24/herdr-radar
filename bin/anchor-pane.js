#!/usr/bin/env node
'use strict';

// A stable pane entrypoint: report AFTER its child has started, and keep this
// process alive. Reporting then exec'ing a different process loses authority
// during Herdr's initial shell/process detection.
const { spawn } = require('node:child_process');
const ipc = require('../lib/ipc');
const { reportAnchor } = require('../lib/anchors');

const command = process.argv[2] ?? '';
const shell = process.env.SHELL || (process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : '/bin/sh');
const args =
  process.platform === 'win32'
    ? command
      ? ['/d', '/s', '/c', command]
      : ['/d', '/k']
    : command
      ? ['-lc', command]
      : ['-i'];
const child = spawn(shell, args, { stdio: 'inherit' });
// Ctrl-C goes to the shared terminal process group. Keep the parent alive so
// cancelling a shell command doesn't destroy the heading's entrypoint.
process.on('SIGINT', () => {});
for (const signal of ['SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
child.on('spawn', () => {
  reportAnchor(process.env.HERDR_PANE_ID, process.env.HERDR_WORKSPACE_ID, ipc.call).catch((error) => {
    console.error(`Radar anchor: ${error.message}`);
  });
});
