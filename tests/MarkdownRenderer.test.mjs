// Standalone unit tests for the chat Markdown renderer.
//
// The renderer is browser ESM living under a CommonJS package, so it can't be
// `require`d directly. We read its source and evaluate it as a plain script
// (it has zero imports), keeping a single source of truth. Run with:
//   node tests/MarkdownRenderer.test.mjs
// This intentionally does NOT go through tests/RunAll.js, which currently fails
// to load the native swisseph addon (see docs/defects/DEF-001).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.join(here, '../src/renderer/app/components/MarkdownRenderer.js');
const src = readFileSync(srcPath, 'utf8').replace(/export\s+function/g, 'function');
// eslint-disable-next-line no-new-func
const { renderMarkdown, escapeHtml } = new Function(`${src}\nreturn { renderMarkdown, escapeHtml };`)();

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
const has = (html, frag) => assert.ok(html.includes(frag), `expected to contain: ${frag}\n      got: ${html}`);
const hasNot = (html, frag) => assert.ok(!html.includes(frag), `expected NOT to contain: ${frag}\n      got: ${html}`);

console.log('\nMarkdownRenderer');

test('escapes HTML to prevent injection', () => {
  const out = renderMarkdown('<img src=x onerror=alert(1)>');
  hasNot(out, '<img');
  has(out, '&lt;img');
});

test('bold and italic', () => {
  const out = renderMarkdown('**bold** and *italic*');
  has(out, '<strong>bold</strong>');
  has(out, '<em>italic</em>');
});

test('inline code is protected from emphasis', () => {
  const out = renderMarkdown('use `a * b * c` here');
  has(out, '<code>a * b * c</code>');
  hasNot(out, '<em>');
});

test('plain numbers are never turned into code (sentinel safety)', () => {
  const out = renderMarkdown('the year 2024 and value 42');
  hasNot(out, '<code>');
  has(out, '2024');
  has(out, '42');
});

test('ATX headings map to h1..h6', () => {
  has(renderMarkdown('# Title'), '<h1>Title</h1>');
  has(renderMarkdown('### Sub'), '<h3>Sub</h3>');
});

test('unordered list', () => {
  const out = renderMarkdown('- one\n- two');
  has(out, '<ul><li>one</li><li>two</li></ul>');
});

test('ordered list', () => {
  const out = renderMarkdown('1. first\n2. second');
  has(out, '<ol><li>first</li><li>second</li></ol>');
});

test('GFM table', () => {
  const out = renderMarkdown('| 行星 | 星座 |\n| --- | --- |\n| 太阳 | 白羊 |\n| 月亮 | 巨蟹 |');
  has(out, '<table>');
  has(out, '<th>行星</th>');
  has(out, '<td>太阳</td>');
  has(out, '<td>巨蟹</td>');
});

test('fenced code block preserves content and escapes it', () => {
  const out = renderMarkdown('```js\nconst a = 1 < 2;\n```');
  has(out, '<pre><code class="language-js">');
  has(out, 'const a = 1 &lt; 2;');
});

test('code fence content is not parsed as markdown', () => {
  const out = renderMarkdown('```\n# not a heading\n- not a list\n| not | a table |\n```');
  hasNot(out, '<h1>');
  hasNot(out, '<li>');
  hasNot(out, '<table>');
});

test('unclosed code fence (streaming) still renders as code', () => {
  const out = renderMarkdown('intro\n\n```python\nprint(1)');
  has(out, '<pre><code class="language-python">');
  has(out, 'print(1)');
});

test('blockquote', () => {
  const out = renderMarkdown('> wisdom here');
  has(out, '<blockquote>wisdom here</blockquote>');
});

test('horizontal rule', () => {
  has(renderMarkdown('---'), '<hr>');
});

test('safe link is rendered, unsafe protocol is rejected', () => {
  has(renderMarkdown('[site](https://example.com)'), '<a href="https://example.com" class="chat-link" rel="noopener">site</a>');
  const bad = renderMarkdown('[x](javascript:alert(1))');
  hasNot(bad, '<a ');
  has(bad, '[x](javascript:alert(1))');
});

test('paragraph keeps single newline as <br>, blank line splits blocks', () => {
  const out = renderMarkdown('line one\nline two\n\nsecond para');
  has(out, '<p>line one<br>line two</p>');
  has(out, '<p>second para</p>');
});

test('strikethrough', () => {
  has(renderMarkdown('~~gone~~'), '<del>gone</del>');
});

test('empty / null input does not throw', () => {
  assert.strictEqual(renderMarkdown(''), '');
  assert.strictEqual(renderMarkdown(null), '');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
