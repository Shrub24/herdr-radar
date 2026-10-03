'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fixtures = require('../tools/test-fixtures');
const { ensureAnchor, createdWorkspace, settings, reportAnchor } = require('../lib/anchors');

function rig(t, extra = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-anchors-'));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const workspace = { workspace_id: 'w1', label: 'my project', active_tab_id: 'w1:t1' };
  const panes = [{ pane_id: 'w1:p1', tab_id: 'w1:t1', workspace_id: 'w1', foreground_cwd: '/project', cwd: '/old' }];
  const calls = [];
  const call = async (method, params) => {
    calls.push({ method, params });
    if (extra.respond) {
      const reply = await extra.respond(method, params);
      if (reply !== undefined) return reply;
    }
    if (method === 'pane.list') return { result: { panes } };
    if (method === 'workspace.get') return { result: { workspace } };
    if (method === 'layout.apply') {
      panes.push({
        pane_id: 'w1:p2',
        terminal_id: 'terminal-new',
        workspace_id: 'w1',
        tab_id: 'w1:t2',
        cwd: '/project',
      });
      return { result: { layout: { workspace_id: 'w1', tab_id: 'w1:t2', root: { type: 'pane', pane_id: 'w1:p2' } } } };
    }
    if (method === 'pane.report_metadata') panes.find((p) => p.pane_id === params.pane_id).tokens = { anchor: '1' };
    return { result: {} };
  };
  return { deps: { call, stateDir, socket: 'test-session' }, calls, panes, workspace };
}

const creates = (r) => r.calls.filter((c) => c.method === 'layout.apply');

test('anchor settings are opt-in and invalid values fail closed', () => {
  assert.deepEqual(settings({}), { autoCreate: false, command: '' });
  assert.deepEqual(settings({ anchors: { auto_create: true, command: 'nvim' } }), {
    autoCreate: true,
    command: 'nvim',
  });
  assert.throws(() => settings({ anchors: { auto_create: 'true' } }));
  assert.throws(() => settings({ anchors: { command: false } }));
});

test('created hook identifies only its event workspace, never focused context', () => {
  const event = JSON.stringify({ event: 'workspace_created', data: { workspace: { workspace_id: 'w2' } } });
  assert.equal(createdWorkspace(event, 'w2'), 'w2');
  assert.equal(createdWorkspace(event), 'w2');
  assert.throws(() => createdWorkspace(event, 'w1'));
  assert.throws(() => createdWorkspace('{}', 'w1'));
  assert.throws(() => createdWorkspace('bad', 'w1'));
  assert.throws(() =>
    createdWorkspace(JSON.stringify({ event: 'workspace_focused', data: { workspace: { workspace_id: 'w2' } } })),
  );
});

test('fresh non-focused argv tab inherits cwd and never replaces or inputs into an existing pane', async (t) => {
  const r = rig(t);
  const result = await ensureAnchor('w1', {}, r.deps);
  assert.equal(result.status, 'created');
  assert.deepEqual(creates(r)[0].params, {
    workspace_id: 'w1',
    tab_label: 'anchor',
    focus: false,
    root: {
      type: 'pane',
      cwd: '/project',
      command: [process.execPath, path.resolve(__dirname, '../bin/anchor-pane.js'), ''],
    },
  });
  assert.ok(!r.calls.some((c) => c.method === 'pane.send_input' || c.method === 'pane.report_agent'));
  await reportAnchor(result.paneId, 'w1', r.deps.call);
  assert.equal((await ensureAnchor('w1', {}, r.deps)).status, 'exists');
  assert.equal(creates(r).length, 1);
});

test('entrypoint reports its own pane once in idle, then publishes its marker', async (t) => {
  const r = rig(t);
  await ensureAnchor('w1', {}, r.deps);
  await reportAnchor('w1:p2', 'w1', r.deps.call);
  const reports = r.calls.filter((c) => c.method.startsWith('pane.report_'));
  assert.deepEqual(
    reports.map((c) => c.params.pane_id),
    ['w1:p2', 'w1:p2'],
  );
  assert.deepEqual(reports[0].params, { pane_id: 'w1:p2', source: 'anchor', agent: 'my project', state: 'idle' });
  assert.deepEqual(reports[1].params, { pane_id: 'w1:p2', source: 'anchor', tokens: { anchor: '1' } });
  await assert.rejects(reportAnchor(undefined, 'w1', r.deps.call));
});

test('a template or manually reported anchor prevents a second one', async (t) => {
  const r = rig(t);
  r.panes[0].tokens = { anchor: '1' };
  assert.equal((await ensureAnchor('w1', {}, r.deps)).status, 'exists');
  assert.equal(creates(r).length, 0);
});

test('custom command stays a single argv value, never interpolated into pane input', async (t) => {
  const r = rig(t);
  await ensureAnchor('w1', { command: 'nvim "my file"' }, r.deps);
  assert.equal(creates(r)[0].params.root.command.at(-1), 'nvim "my file"');
});

test('failed inventory, workspace lookup or missing cwd never creates a tab', async (t) => {
  for (const method of ['pane.list', 'workspace.get']) {
    const r = rig(t, { respond: (m) => (m === method ? null : undefined) });
    await assert.rejects(ensureAnchor('w1', {}, r.deps));
    assert.equal(creates(r).length, 0);
  }
  const r = rig(t);
  delete r.panes[0].foreground_cwd;
  delete r.panes[0].cwd;
  await assert.rejects(ensureAnchor('w1', {}, r.deps));
  assert.equal(creates(r).length, 0);
});

test('overlapping hook and retrofit serialize creation', async (t) => {
  const r = rig(t);
  const results = await Promise.all([ensureAnchor('w1', {}, r.deps), ensureAnchor('w1', {}, r.deps)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['busy', 'created']);
  assert.equal(creates(r).length, 1);
});

test('a starting entrypoint cannot cause a second tab before it publishes its marker', async (t) => {
  const r = rig(t);
  await ensureAnchor('w1', {}, r.deps);
  await assert.rejects(ensureAnchor('w1', {}, r.deps), /pending/);
  assert.equal(creates(r).length, 1);
});

test('a failed entrypoint report is not mistaken for a ready anchor', async (t) => {
  const r = rig(t, { respond: (m) => (m === 'pane.report_agent' ? { error: { code: 'temporary' } } : undefined) });
  await ensureAnchor('w1', {}, r.deps);
  await assert.rejects(reportAnchor('w1:p2', 'w1', r.deps.call));
  assert.ok(!r.panes[1].tokens?.anchor);
  await assert.rejects(ensureAnchor('w1', {}, r.deps), /pending/);
  assert.equal(creates(r).length, 1);
});

test('an explicit action can replace a receipted anchor whose pane has closed', async (t) => {
  const r = rig(t);
  await ensureAnchor('w1', {}, r.deps);
  r.panes.pop();
  assert.equal((await ensureAnchor('w1', {}, r.deps)).status, 'created');
  assert.equal(creates(r).length, 2);
});

test('a lost creation receipt prevents blind retry', async (t) => {
  const r = rig(t, { respond: (m) => (m === 'layout.apply' ? null : undefined) });
  await assert.rejects(ensureAnchor('w1', {}, r.deps));
  await assert.rejects(ensureAnchor('w1', {}, r.deps), /uncertain/);
  assert.equal(creates(r).length, 1);
});

test('quoted command settings survive escapes and embedded comment characters', () => {
  const { parseToml } = require('../lib/config');
  const command = 'nvim "a#b"';
  const raw = parseToml(`[anchors]
  command = ${JSON.stringify(command)} # comment
  auto_create = true`);

  assert.deepEqual(settings(raw), { autoCreate: true, command });
});

test('CLI is a no-write/no-spawn operation when disabled, and rejects conflicting modes', (t) => {
  const home = fixtures.home(t);
  fixtures.stubHerdr(home);
  for (const args of [['--created'], ['--all', '--created'], ['--what'], []]) {
    const before = fixtures.snapshot(home);
    const out = spawnSync(process.execPath, ['bin/anchors.js', ...args], {
      cwd: path.join(__dirname, '..'),
      env: fixtures.env(home),
      encoding: 'utf8',
    });
    assert.equal(out.status, args.length === 1 && args[0] === '--created' ? 0 : 2, out.stderr);
    fixtures.assertUnchanged(before, fixtures.snapshot(home), 'disabled/invalid invocation');
    fixtures.assertNothingSpawned(home, 'disabled/invalid invocation');
  }
});
