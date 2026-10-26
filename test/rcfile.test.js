import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEGIN, END, findBlocks, upsertBlock, removeBlocks, renderBlock } from '../src/rcfile.js';

const block = renderBlock('zsh');

test('upsert appends a block and keeps existing lines', () => {
  const before = 'export FOO=1\nalias ll="ls -l"\n';
  const after = upsertBlock(before, block);
  assert.ok(after.startsWith(before));
  assert.equal(findBlocks(after).length, 1);
});

test('upsert is idempotent', () => {
  const once = upsertBlock('x=1\n', block);
  assert.equal(upsertBlock(once, block), once);
});

test('upsert adds a newline separator when the file lacks one', () => {
  const after = upsertBlock('x=1', block);
  assert.ok(after.startsWith('x=1\n# >>>'));
});

test('upsert replaces an outdated block in place', () => {
  const old = `a\n${BEGIN}\nold line\n${END}\nb\n`;
  const after = upsertBlock(old, block);
  assert.equal(after, `a\n${block}\nb\n`);
});

test('upsert collapses duplicate blocks into the first one', () => {
  const dup = `a\n${BEGIN}\nx\n${END}\nb\n${BEGIN}\ny\n${END}\nc\n`;
  const after = upsertBlock(dup, block);
  assert.equal(findBlocks(after).length, 1);
  assert.equal(after, `a\n${block}\nb\nc\n`);
});

test('remove restores the original file byte-for-byte', () => {
  const original = '# my rc\nexport PATH="$HOME/bin:$PATH"\n';
  assert.equal(removeBlocks(upsertBlock(original, block)), original);
});

test('remove leaves files without a block untouched', () => {
  assert.equal(removeBlocks('a\nb\n'), 'a\nb\n');
});

test('every shell renders a block with the init line', () => {
  for (const shell of ['zsh', 'bash', 'fish', 'pwsh']) {
    assert.match(renderBlock(shell), new RegExp(`init ${shell}`));
  }
  assert.throws(() => renderBlock('tcsh'), /Unsupported shell/);
});
