'use strict';

// A pi-herdsman lead and its workers are panes in one tab, and the sidebar
// draws them as a tree: a worker follows the owner it belongs to, one level in.
//
// The join is on the Herdsman session UUIDs. Herdr's `agent_session` carries
// the session FILE path, so it identifies nothing here, and a worker whose
// owner is not on the same screen stands on its own rather than hang under
// nothing.

const test = require('node:test');
const assert = require('node:assert/strict');

const herdr = require('../lib/herdr');
const state = require('../lib/state');
const view = require('../lib/view');
const { Frame } = require('../lib/frame');

const pane = (pane, workspace, tab, herdsman, extra = {}) => ({
  pane,
  workspace,
  tab,
  name: 'pi',
  title: 'work',
  status: 'idle',
  session: '/tmp/session.jsonl',
  focused: false,
  herdsman,
  ...extra,
});
const lead = (p, w, t, session) => pane(p, w, t, { session, parent: '' });
const worker = (p, w, t, session, parent) => pane(p, w, t, { session, parent });

/* ---------------------------------------------------------------- lineage */

test('snapshot reads the lineage tokens, not the agent_session path', async (t) => {
  t.mock.method(herdr, 'agentsAsync', async () => [
    {
      pane_id: 'w:p1',
      agent_status: 'working',
      agent: 'pi',
      workspace_id: 'w',
      tab_id: 'w:t1',
      agent_session: { source: 'herdr:pi', agent: 'pi', kind: 'path', value: '/tmp/a.jsonl' },
      tokens: { pi_herdsman_session: 'LEAD', pi_herdsman_role: 'lead' },
    },
    {
      pane_id: 'w:p2',
      agent_status: 'working',
      agent: 'pi',
      workspace_id: 'w',
      tab_id: 'w:t1',
      tokens: { pi_herdsman_session: 'W1', pi_herdsman_parent_session: 'LEAD' },
    },
    { pane_id: 'w:p3', agent_status: 'idle', agent: 'claude', workspace_id: 'w', tab_id: 'w:t1' },
  ]);
  const entries = await state.snapshot();
  assert.deepEqual(entries[0].herdsman, { session: 'LEAD', parent: '' });
  assert.deepEqual(entries[1].herdsman, { session: 'W1', parent: 'LEAD' });
  assert.equal(entries[2].herdsman, null, 'a pane with no herdsman tokens carries no lineage');
});

/* ------------------------------------------------------------------- tree */

test('a worker nests under the owner it names', () => {
  const tree = state.paneTree([
    lead('w:p1', 'w', 'w:t1', 'LEAD'),
    worker('w:p2', 'w', 'w:t1', 'W1', 'LEAD'),
    worker('w:p3', 'w', 'w:t1', 'W2', 'LEAD'),
  ]);
  assert.equal(tree.depth.get('w:p1'), 0);
  assert.deepEqual([tree.depth.get('w:p2'), tree.depth.get('w:p3')], [1, 1]);
  assert.ok(tree.head.has('w:p1'), 'the owner heads the rows beneath it');
  assert.equal(tree.closes.has('w:p3'), true, 'the last worker closes the branch');
  assert.equal(tree.closes.has('w:p2'), false, 'an earlier worker continues it');
});

test('a chain nests one level per generation', () => {
  const tree = state.paneTree([
    lead('w:p1', 'w', 'w:t1', 'LEAD'),
    worker('w:p2', 'w', 'w:t1', 'W1', 'LEAD'),
    worker('w:p3', 'w', 'w:t1', 'W2', 'W1'),
  ]);
  assert.deepEqual(
    ['w:p1', 'w:p2', 'w:p3'].map((p) => tree.depth.get(p)),
    [0, 1, 2],
  );
});

test('a worker whose owner is in another tab stands on its own', () => {
  const tree = state.paneTree([lead('w:p1', 'w', 'w:t1', 'LEAD'), worker('w:p2', 'w', 'w:t2', 'W1', 'LEAD')]);
  assert.equal(tree.depth.get('w:p2'), 0);
});

test('a worker whose owner is gone stands on its own', () => {
  const tree = state.paneTree([worker('w:p2', 'w', 'w:t1', 'W1', 'LEAD')]);
  assert.equal(tree.depth.get('w:p2'), 0);
});

test('two workers pointing at each other do not descend and stay unordered', () => {
  const tree = state.paneTree([worker('w:p1', 'w', 'w:t1', 'A', 'B'), worker('w:p2', 'w', 'w:t1', 'B', 'A')]);
  assert.equal(tree.rank.size, 0, 'a cycle leaves both panes to their own order');
});

/* ------------------------------------------------------------------ order */

test('workers follow their owner ahead of recency', () => {
  const frame = new Frame('test');
  const now = Date.now();
  // The lead worked longest ago; with no tree the panel would draw it last.
  frame.lastWorkingAt.set('w:p1', now - 600000);
  frame.lastWorkingAt.set('w:p2', now);
  frame.lastWorkingAt.set('w:p3', now);
  const entries = [
    lead('w:p1', 'w', 'w:t1', 'LEAD'),
    worker('w:p2', 'w', 'w:t1', 'W1', 'LEAD'),
    worker('w:p3', 'w', 'w:t1', 'W2', 'LEAD'),
  ];
  const keys = frame.sortKeys(entries, new Map(), new Map());
  assert.deepEqual(
    frame.displayOrder(entries, 'grouped', keys).map((e) => e.pane),
    ['w:p1', 'w:p2', 'w:p3'],
  );
});

test('without herdsman tokens a tab still draws its head first, then recency', () => {
  const frame = new Frame('test');
  const now = Date.now();
  frame.lastWorkingAt.set('w:p1', now - 600000);
  frame.lastWorkingAt.set('w:p2', now);
  const entries = [pane('w:p1', 'w', 'w:t1', null), pane('w:p2', 'w', 'w:t1', null)];
  const keys = frame.sortKeys(entries, new Map(), new Map());
  assert.deepEqual(
    frame.displayOrder(entries, 'grouped', keys).map((e) => e.pane),
    ['w:p1', 'w:p2'],
  );
});

/* ------------------------------------------------------------------ heads */

test('the lead heads its workspace when there is no anchor', () => {
  const entries = [worker('w:p2', 'w', 'w:t1', 'W1', 'LEAD'), lead('w:p1', 'w', 'w:t1', 'LEAD')];
  const tree = state.paneTree(entries);
  const { heads } = state.groupBoundaries(entries, tree.head);
  assert.deepEqual([...heads], ['w:p1']);
});

test('an anchor still heads a workspace that also has a lead', () => {
  const entries = [lead('w:p1', 'w', 'w:t1', 'LEAD'), pane('w:pA', 'w', 'w:t1', null, { anchor: true })];
  const tree = state.paneTree(entries);
  const { heads } = state.groupBoundaries(entries, tree.head);
  assert.deepEqual([...heads], ['w:pA']);
});

/* ------------------------------------------------------------------ rows */

// The production path: one render, every token Radar publishes for the panes.
async function renderRows(t, entries, workspaces) {
  const rows = new Map();
  t.mock.method(state, 'snapshot', async () => entries);
  t.mock.method(state, 'labels', async () => ({
    tabs: new Map(),
    workspaces: new Map(workspaces),
    parents: new Map(),
    worktrees: new Map(),
  }));
  t.mock.method(state, 'writeSpaceState', async () => true);
  t.mock.method(state, 'writeGroups', async () => ({ heads: new Set(), ok: true }));
  t.mock.method(state, 'sweepOrphans', async () => true);
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    rows.set(pane, Object.assign(rows.get(pane) ?? {}, tokens));
    return true;
  });
  t.mock.method(herdr, 'reportMetadata', () => true);
  t.mock.method(view, 'mode', () => 'grouped');
  const frame = new Frame('test');
  frame.workspaceOrder = { sync: async () => {} };
  await frame.render(Date.now());
  return rows;
}

const rowText = (rows, pane) =>
  Object.values(rows.get(pane) ?? {})
    .filter((value) => typeof value === 'string')
    .join('');

test('the owner writes at the margin and its worker one level in, ahead of it', async (t) => {
  const rows = await renderRows(
    t,
    [lead('w:p1', 'w', 'w:t1', 'LEAD'), worker('w:p2', 'w', 'w:t1', 'W1', 'LEAD')],
    [['w', 'proj']],
  );
  assert.ok(!rowText(rows, 'w:p1').includes(state.INDENT), 'the lead sits at the margin');
  assert.ok(rowText(rows, 'w:p2').includes(state.INDENT), 'the worker is indented under it');
  assert.ok(
    rows.get('w:p1').tab_key > rows.get('w:p2').tab_key,
    'the worker ranks below its owner, so the panel draws them in that order',
  );
});
