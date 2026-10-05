'use strict';

// Herdr caps a sidebar list at 16 rows and at 16 tokens in one row, and it
// rejects the WHOLE config file when either is exceeded — the sidebar then
// silently falls back to Herdr's default look, keybindings and theme included.
//
// Both counts are generated, so they move whenever the palette does: the vendor
// roster that colours the Spaces panel had already pushed a row to eighteen
// tokens before anyone noticed. This is where that is caught instead of in a
// user's config, which is where it was caught for real.

const test = require('node:test');
const assert = require('node:assert/strict');

const managed = require('../lib/managed-config');
const palette = require('../lib/palette');

const ROW_LIMIT = 16;
const TOKEN_LIMIT = 16;

// Every `key = [...]` list in a generated block, by matching brackets from the
// `[` that opens each one. Anchored at the line start so a cell's own
// `rules = [...]` — indented, and nested inside the row it belongs to — is not
// mistaken for a list.
function rowBodies(text) {
  const bodies = [];
  for (const match of text.matchAll(/(?:^|\n)[\w.]+ = \[/g)) {
    const start = match.index + match[0].length - 1;
    let depth = 0;
    for (let index = start; index < text.length; index += 1) {
      if (text[index] === '[') depth += 1;
      else if (text[index] === ']') {
        depth -= 1;
        if (depth === 0) {
          bodies.push(text.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return bodies;
}

// Rows of one list body, split at bracket depth 1: a cell's own `rules = [...]`
// nests brackets inside the row it belongs to.
function rowsOf(body) {
  const inner = body.startsWith('[') && body.endsWith(']') ? body.slice(1, -1) : body;
  const rows = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index];
    if (character === '[') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
      if (depth === 0) rows.push(inner.slice(start, index + 1));
    }
  }
  return rows;
}

// Tokens named in one row: a styled cell's `token = "$x"`, plus the bare
// `"$x"` of an unstyled one. A rule's glyph is not a token.
function tokensIn(row) {
  const styled = (row.match(/token = "/g) ?? []).length;
  const bare = (row.match(/(?<![:=] )"\$\w+"/g) ?? []).length;
  return styled + bare;
}

const spacesBody = (text) => rowBodies(text.slice(text.indexOf('[ui.sidebar.spaces]'))).at(-1);

test('every generated sidebar row fits both of Herdr ceilings', () => {
  const bodies = rowBodies(managed.sidebarBlock('dark'));
  // The default Agents row, one per branded vendor, and the Spaces rows.
  assert.ok(bodies.length >= 3, `expected several lists, found ${bodies.length}`);
  for (const body of bodies) {
    const rows = rowsOf(body);
    assert.ok(rows.length <= ROW_LIMIT, `${rows.length} rows in one list; Herdr allows ${ROW_LIMIT}`);
    for (const row of rows) {
      const count = tokensIn(row);
      assert.ok(count <= TOKEN_LIMIT, `${count} tokens in one row; Herdr allows ${TOKEN_LIMIT}`);
    }
  }
});

test('the vendor roster gets a row of its own, and the name stays on the first', () => {
  const rows = rowsOf(spacesBody(managed.sidebarBlock('dark')));
  assert.equal(rows.length, 3);
  assert.match(rows[0], /\$space_label/);
  assert.match(rows[1], /\$space_working_/);
  assert.doesNotMatch(rows[0], /\$space_working_/);
});

test('a roster that outgrows a row is refused rather than written', () => {
  const added = Array.from({ length: 20 }, (unused, index) => `zzz${index}`);
  for (const vendor of added) palette.brand[vendor] = '#ff0000';
  palette.brandVendors.push(...added);
  try {
    assert.throws(() => managed.sidebarBlock('dark'), /spaces: sidebar row would carry \d+ tokens; Herdr allows 16/);
  } finally {
    for (const vendor of added) delete palette.brand[vendor];
    palette.brandVendors.length -= added.length;
  }
  // And the real palette still fits, so the failure above was the roster alone.
  assert.doesNotThrow(() => managed.sidebarBlock('dark'));
});
