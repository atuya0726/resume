import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proseBlocks } from '../src/document-prose.ts';

test('paragraphs, subsection headings and mixed lists retain their text', () => {
  const blocks = proseBlocks('架空の改善活動\r\n\r\n説明の文章です。\r\n続きの文章です。\r\n\r\n- 架空の項目A\r\n- 架空の項目B\r\n補足の文章です。');
  assert.deepEqual(blocks, [
    { kind: 'heading', text: '架空の改善活動' },
    { kind: 'paragraph', text: '説明の文章です。\n続きの文章です。' },
    { kind: 'list', items: ['架空の項目A', '架空の項目B'] },
    { kind: 'paragraph', text: '補足の文章です。' },
  ]);
  assert.deepEqual(proseBlocks('短い文章です。\n\n次の文章です。').map((block) => block.kind), ['paragraph', 'paragraph']);
});

test('task lines become lists while long narrative and literal markup stay intact', () => {
  assert.deepEqual(proseBlocks('架空の要件整理\n架空の設計\n架空のレビュー', true), [{ kind: 'list', items: ['架空の要件整理', '架空の設計', '架空のレビュー'] }]);
  const long = '架空の長い文章。'.repeat(400) + '\n末尾の文章です。';
  assert.deepEqual(proseBlocks(long, true), [{ kind: 'paragraph', text: long }]);
  const literal = '<img src=x onerror="window.__injected=true">';
  assert.deepEqual(proseBlocks(literal), [{ kind: 'paragraph', text: literal }]);
  assert.deepEqual(proseBlocks('【架空の見出し】\n本文です。'), [{ kind: 'heading', text: '架空の見出し' }, { kind: 'paragraph', text: '本文です。' }]);
  assert.deepEqual(proseBlocks(''), []);
});
