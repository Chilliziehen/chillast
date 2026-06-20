// MarkdownRenderer.js — block-aware Markdown → safe HTML for the AI chat.
//
// Zero-dependency, matching the app's hand-rolled renderer philosophy. The
// pipeline is ordered so LLM output can never inject markup and so structural
// tokens inside code are never mangled:
//
//   raw → extract fenced code (placeholders) → group into blocks
//       → inline-format block text (escape first) → restore code
//
// Supports: ATX headings, fenced + inline code, GFM tables, ordered/unordered
// lists, blockquotes, horizontal rules, links (http/https/mailto only),
// bold/italic/strikethrough, and paragraph-scoped line breaks. An unclosed
// trailing code fence is tolerated so partial streaming output still renders.
//
// Placeholders use a NUL sentinel that never appears in real text:
//   {NUL}B{n}{NUL} → fenced code block #n ; {NUL}I{n}{NUL} → inline code span #n

const NUL = String.fromCharCode(0);
const CODE_LINE = new RegExp(`^\\s*${NUL}B(\\d+)${NUL}\\s*$`);
const SPAN_RESTORE = new RegExp(`${NUL}I(\\d+)${NUL}`, 'g');

export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Only allow safe protocols; returns a sanitized href or null to reject.
function sanitizeUrl(url) {
  const u = String(url).trim();
  if (/^(https?:\/\/|mailto:)/i.test(u)) {
    return u.replace(/"/g, '%22').replace(/\s/g, '%20');
  }
  return null;
}

// Inline-level formatting. Escapes HTML first, protects inline code spans,
// then applies emphasis/links. Operates on already-block-split text.
function inline(text) {
  let s = escapeHtml(text);

  // Protect inline code spans (content already escaped) so emphasis rules skip them.
  const spans = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => `${NUL}I${spans.push(c) - 1}${NUL}`);

  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  s = s.replace(/~~([^~]+?)~~/g, '<del>$1</del>');

  // [text](url) — reject unsafe protocols by leaving the literal markdown.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, txt, url) => {
    const safe = sanitizeUrl(url);
    return safe
      ? `<a href="${safe}" class="chat-link" rel="noopener">${txt}</a>`
      : `[${txt}](${url})`;
  });

  // Restore inline code spans.
  s = s.replace(SPAN_RESTORE, (_m, k) => `<code>${spans[Number(k)]}</code>`);
  return s;
}

function isTableSeparator(line) {
  return line.includes('-')
    && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);
}

function splitRow(line) {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return s.split('|').map((c) => c.trim());
}

function buildTable(header, rows) {
  const th = header.map((c) => `<th>${inline(c)}</th>`).join('');
  const body = rows.map((r) => {
    const tds = [];
    for (let k = 0; k < header.length; k++) tds.push(`<td>${inline(r[k] || '')}</td>`);
    return `<tr>${tds.join('')}</tr>`;
  }).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

function isBlockStart(line) {
  return CODE_LINE.test(line)
    || /^#{1,6}\s+/.test(line)
    || /^\s*([-*_])\1{2,}\s*$/.test(line)
    || /^\s*>\s?/.test(line)
    || /^\s*([-*+]|\d+\.)\s+/.test(line);
}

export function renderMarkdown(text) {
  const codeBlocks = [];
  let src = String(text == null ? '' : text);

  // 1. Extract closed fenced code blocks, then any unclosed trailing fence
  //    (the latter keeps streaming output readable mid-generation).
  src = src.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const i = codeBlocks.push({ lang: lang.trim(), code }) - 1;
    return `\n${NUL}B${i}${NUL}\n`;
  });
  src = src.replace(/```([^\n`]*)\n([\s\S]*)$/, (_m, lang, code) => {
    const i = codeBlocks.push({ lang: lang.trim(), code }) - 1;
    return `\n${NUL}B${i}${NUL}\n`;
  });

  const lines = src.split('\n');
  const out = [];
  const isBlank = (l) => /^\s*$/.test(l);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) { i++; continue; }

    // Code block placeholder.
    let m = line.match(CODE_LINE);
    if (m) {
      const blk = codeBlocks[Number(m[1])];
      const cls = blk.lang ? ` class="language-${escapeHtml(blk.lang)}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(blk.code.replace(/\n$/, ''))}</code></pre>`);
      i++;
      continue;
    }

    // ATX heading.
    m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      const lvl = m[1].length;
      out.push(`<h${lvl}>${inline(m[2].trim())}</h${lvl}>`);
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // GFM table: a row line followed by a separator line.
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|') && !CODE_LINE.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(buildTable(header, rows));
      continue;
    }

    // Blockquote.
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
      continue;
    }

    // List (ordered or unordered).
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        items.push(`<li>${inline(item)}</li>`);
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // Paragraph: accumulate until a blank line or the start of another block.
    const buf = [];
    while (i < lines.length && !isBlank(lines[i]) && !isBlockStart(lines[i])
      && !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }

  return out.join('');
}
