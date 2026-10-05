'use strict';

// Pi writes its own mark into the terminal title (`π <session>`, or
// `π - <session> - <dir>` when it names the directory too). The row already
// draws the Pi logo beside the title, so the mark says the same thing twice.

const test = require('node:test');
const assert = require('node:assert/strict');

const herdr = require('../lib/herdr');
const state = require('../lib/state');

const titleOf = async (t, agent) => {
  t.mock.method(herdr, 'agentsAsync', async () => [
    { pane_id: 'w:p1', agent_status: 'idle', cwd: '/work/keypeek', tokens: {}, ...agent },
  ]);
  return (await state.snapshot())[0].title;
};

test('the leading Pi mark is dropped from a session title', async (t) => {
  const title = await titleOf(t, { agent: 'pi', terminal_title_stripped: 'π Cache bust diagnosis' });
  assert.equal(title, 'Cache bust diagnosis');
});

test('the dashed form loses its mark and keeps the words', async (t) => {
  const title = await titleOf(t, { agent: 'pi', terminal_title_stripped: 'π - Swap evidence recorded - nix-homelab' });
  assert.equal(title, 'Swap evidence recorded - nix-homelab');
});

test('a title that was only the mark and the directory falls back to the vendor name', async (t) => {
  const title = await titleOf(t, { agent: 'pi', terminal_title_stripped: 'π - keypeek' });
  assert.notEqual(title, 'π - keypeek');
  assert.ok(!title.includes('π'), title);
});

test('another agent keeps a title that happens to open with π', async (t) => {
  const title = await titleOf(t, { agent: 'claude', terminal_title_stripped: 'π approximation' });
  assert.equal(title, 'π approximation');
});

test('a Pi title that merely contains π later on is untouched', async (t) => {
  const title = await titleOf(t, { agent: 'pi', terminal_title_stripped: 'Why π is irrational' });
  assert.equal(title, 'Why π is irrational');
});
