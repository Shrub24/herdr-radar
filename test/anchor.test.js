'use strict';

// A workspace's anchor pane is its heading.
//
// The anchor is a pane that reports itself as an agent (`anchor/herdr-anchor`)
// so the workspace has an Agents entry even with nothing running, and it
// publishes the marker token `anchor`, because its label is the workspace's own
// name and says nothing about what it is. Radar draws that entry as the group
// header and nothing else: no agent row, no say in the workspace's staleness,
// activity or logos, and always first in its workspace. A workspace without one
// is drawn exactly as before.

const test = require('node:test');
const assert = require('node:assert/strict');

const herdr = require('../lib/herdr');
const state = require('../lib/state');
const view = require('../lib/view');
const { Frame } = require('../lib/frame');

const agent = (pane, workspace, tab, extra = {}) => ({
  pane,
  workspace,
  tab,
  name: 'claude',
  title: 'work',
  status: 'idle',
  session: '',
  focused: false,
  ...extra,
});
const anchor = (pane, workspace, tab, extra = {}) =>
  agent(pane, workspace, tab, { name: workspace, anchor: true, ...extra });

const noKeys = (extra = {}) => ({
  minuteKey: () => null,
  wsKeys: new Map(),
  tabKeys: new Map(),
  parentOf: new Map(),
  orphanRepo: new Map(),
  ...extra,
});

/* ------------------------------------------------------------- detection */

test('an entry carrying the anchor token is an anchor; one without it is not', async (t) => {
  t.mock.method(herdr, 'agentsAsync', async () => [
    {
      pane_id: 'w:p1',
      agent_status: 'idle',
      agent: 'proj',
      workspace_id: 'w',
      tab_id: 'w:t1',
      tokens: { anchor: '1' },
    },
    { pane_id: 'w:p2', agent_status: 'idle', agent: 'claude', workspace_id: 'w', tab_id: 'w:t1', tokens: {} },
    { pane_id: 'w:p3', agent_status: 'idle', agent: 'claude', workspace_id: 'w', tab_id: 'w:t2' },
  ]);
  const entries = await state.snapshot();
  assert.deepEqual(
    entries.map((e) => [e.pane, e.anchor]),
    [
      ['w:p1', true],
      ['w:p2', false],
      ['w:p3', false],
    ],
  );
});

/* ---------------------------------------------------------------- heads */

test('the anchor heads its workspace even when Herdr lists an agent first', () => {
  const { heads, tails } = state.groupBoundaries([
    agent('w:p2', 'w', 't'),
    anchor('w:p1', 'w', 't'),
    agent('x:p1', 'x', 'u'),
  ]);
  assert.deepEqual([...heads].sort(), ['w:p1', 'x:p1'], 'w is headed by its anchor, x by its first pane');
  assert.deepEqual([...tails].sort(), ['w:p1', 'x:p1']);
});

test('a workspace without an anchor keeps its first pane as head', () => {
  const { heads } = state.groupBoundaries([agent('w:p1', 'w', 't'), agent('w:p2', 'w', 't')]);
  assert.deepEqual([...heads], ['w:p1']);
});

test('only the first anchor of a workspace is its head', () => {
  const { heads } = state.groupBoundaries([anchor('w:p1', 'w', 't'), anchor('w:p2', 'w', 't')]);
  assert.deepEqual([...heads], ['w:p1']);
});

/* --------------------------------------------------------------- header */

async function groupTokens(t, entries, stale = new Set()) {
  const sent = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    sent.set(pane, tokens);
    return true;
  });
  await state.writeGroups('test', entries, new Map([['w', 'proj']]), stale);
  return sent;
}

test('the anchor carries the workspace name and no agent carries it', async (t) => {
  const sent = await groupTokens(t, [anchor('w:p1', 'w', 't'), agent('w:p2', 'w', 't'), agent('w:p3', 'w', 'u')]);
  assert.equal(sent.get('w:p1').group, 'proj');
  assert.equal(sent.get('w:p2').group, null);
  assert.equal(sent.get('w:p3').group, null);
});

test('a dormant workspace fades the anchor heading like any other header', async (t) => {
  const sent = await groupTokens(t, [anchor('w:p1', 'w', 't')], new Set(['w']));
  assert.equal(sent.get('w:p1').group, null);
  assert.equal(sent.get('w:p1').group_stale, 'proj');
});

/* ------------------------------------------------------------- row tokens */

function paneTokens(t, frame, entry) {
  const sent = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (_pane, _source, tokens) => {
    sent.push(tokens);
    return true;
  });
  t.mock.method(herdr, 'reportMetadata', () => true);
  const keys = { minuteKey: () => null, wsKeys: new Map([['w', 'ws']]), tabKeys: new Map([[entry.pane, 'tk']]) };
  const jobs = [];
  frame.paneJobs(entry, 'idle', { tabs: new Map(), keys, indent: '', spinStep: 0 }, 0, [], jobs);
  return Promise.all(jobs).then(() => sent);
}

test('the anchor publishes no agent row, no logo, and keeps its sort keys', async (t) => {
  const sent = await paneTokens(t, new Frame('test'), anchor('w:p1', 'w', 't', { name: 'claude' }));
  const merged = Object.assign({}, ...sent);
  for (const name of [
    ...state.STATES.flatMap((s) => [`name_${s}`, `state_${s}`, `title_${s}`]),
    ...state.LOGO_TOKENS,
  ]) {
    assert.equal(merged[name] ?? null, null, `${name} must be empty on an anchor`);
  }
  assert.equal(merged.harness_logo, null, 'a workspace named after a vendor must not draw its logo');
  assert.equal(merged.ws_key, 'ws', 'the sort keys must survive the row being cleared');
  assert.equal(merged.tab_key, 'tk');
  assert.ok(
    sent.every((tokens) => !('sort_key' in tokens && 'name_idle' in tokens)),
    'the row clear must not travel with the sort keys, or a stale clear erases them',
  );
});

test('an ordinary agent still publishes its row', async (t) => {
  const sent = await paneTokens(t, new Frame('test'), agent('w:p2', 'w', 't'));
  assert.ok(Object.assign({}, ...sent).title_idle, 'the agent row is drawn');
});

/* ------------------------------------------------------------------ sort */

test('the anchor ranks above everything else in its workspace', () => {
  const frame = new Frame('test');
  frame.lastWorkingAt.set('w:p2', Date.now());
  frame.lastWorkingAt.set('w:p3', Date.now());
  const entries = [agent('w:p2', 'w', 't'), anchor('w:p1', 'w', 't'), agent('w:p3', 'w', 'u')];
  const keys = frame.sortKeys(entries, new Map(), new Map());
  const anchorKey = keys.tabKeys.get('w:p1');
  for (const pane of ['w:p2', 'w:p3']) {
    assert.ok(anchorKey > keys.tabKeys.get(pane), `anchor tab_key must outrank ${pane}`);
  }
  assert.equal(
    frame.displayOrder(entries, 'grouped', keys)[0].pane,
    'w:p1',
    'the anchor is first in the display order',
  );
});

test('the anchor does not make its tab a split screen', () => {
  const frame = new Frame('test');
  const entries = [anchor('w:p1', 'w', 't'), agent('w:p2', 'w', 't')];
  const keys = frame.sortKeys(entries, new Map(), new Map());
  assert.equal(keys.splitChild(entries[1]), false, 'an agent beside the anchor is not a split child');
});

test('without an anchor a split tab is still a split', () => {
  const frame = new Frame('test');
  const entries = [agent('w:p1', 'w', 't'), agent('w:p2', 'w', 't')];
  const keys = frame.sortKeys(entries, new Map(), new Map());
  assert.equal(keys.splitChild(entries[1]), true);
});

test('an anchor-only workspace is ranked, so it is listed', () => {
  const frame = new Frame('test');
  const keys = frame.sortKeys([anchor('w:p1', 'w', 't')], new Map(), new Map());
  assert.ok(keys.wsKeys.has('w'));
  assert.ok(keys.tabKeys.has('w:p1'));
});

/* ------------------------------------------------------------- aggregates */

async function render(t, entries, workspaces) {
  const spaces = [];
  const groups = [];
  t.mock.method(state, 'snapshot', async () => entries);
  t.mock.method(state, 'labels', async () => ({
    tabs: new Map(),
    workspaces: new Map(workspaces),
    parents: new Map(),
    worktrees: new Map(),
  }));
  t.mock.method(state, 'writeSpaceState', async (_s, ws, token, _glyph, logos) => {
    spaces.push({ ws, token, logos });
    return true;
  });
  t.mock.method(state, 'writeGroups', async (_s, _e, _w, stale) => {
    groups.push(stale);
    return { heads: new Set(), ok: true };
  });
  t.mock.method(state, 'sweepOrphans', async () => true);
  t.mock.method(herdr, 'reportMetadataAsync', async () => true);
  t.mock.method(herdr, 'reportMetadata', () => true);
  t.mock.method(view, 'mode', () => 'grouped');
  const frame = new Frame('test');
  frame.workspaceOrder = { sync: async () => {} };
  await frame.render(Date.now());
  return { spaces, groups };
}

test('an anchor-only workspace shows the empty mark and a dimmed heading', async (t) => {
  // Named after a vendor on purpose: the anchor's label must not draw a logo.
  const { spaces, groups } = await render(t, [anchor('w:p1', 'w', 't', { name: 'claude' })], [['w', 'proj']]);
  const space = spaces.find((s) => s.ws === 'w');
  assert.equal(space.token, 'space_none', 'no live agent, so no activity');
  assert.deepEqual(Object.values(space.logos).filter(Boolean), [], 'the anchor adds no vendor logo');
  assert.ok(groups[0].has('w'), 'a workspace with nothing running reads as asleep');
});

test('the anchor adds nothing to its workspace: staleness, mark and logos follow the agents', async (t) => {
  const { spaces, groups } = await render(
    t,
    [anchor('w:p1', 'w', 't', { name: 'claude' }), agent('w:p2', 'w', 't', { status: 'working' })],
    [['w', 'proj']],
  );
  const space = spaces.find((s) => s.ws === 'w');
  assert.notEqual(space.token, 'space_none', 'the working agent still marks the workspace');
  assert.equal(groups[0].has('w'), false, 'a working agent keeps the heading lit');
});

test('a workspace without an anchor is aggregated exactly as before', async (t) => {
  const { spaces, groups } = await render(t, [agent('w:p2', 'w', 't', { status: 'working' })], [['w', 'proj']]);
  assert.notEqual(spaces.find((s) => s.ws === 'w').token, 'space_none');
  assert.equal(groups[0].has('w'), false);
});
