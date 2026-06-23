// classify.mjs — Stage 2: route cleaned book sections into per-domain files.
//
// Corpus-driven: the domain taxonomy + classification prompt come from a corpus
// config (tools/corpora/<id>.mjs). Lossless reorganization — a cleaned book is
// split into sections (by ##/### or by size), each section is classified into one
// domain (LLM over heading + excerpt, with a deterministic keyword fallback), then
// sections are written grouped by (book, domain). No content is summarized; we
// assert char counts match. Each output file carries a <!-- domain: id --> marker
// the KnowledgeBase reads directly.

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { extractText, mapWithConcurrency, withRetry, parseJsonArray } from './util.mjs';

export const SEG_CHARS = Number(process.env.SPLIT_SEG_CHARS || 3500);
const MIN_SEG_CHARS = 200;
const CLASSIFY_BATCH = Number(process.env.SPLIT_BATCH || 18);
const CLASSIFY_CONCURRENCY = Number(process.env.SPLIT_CONCURRENCY || 3);

const GENERAL_DOMAIN = { id: 'general', zh: '综合', desc: '导论、概述、源流、方法论等通用内容', kw: [] };

// Deterministic fallback taxonomy for generic corpora when no LLM is available —
// broad enough to fit most术数/玄学 books (六壬/易学/堪舆/择日/梅花/天文历法…).
const GENERIC_DOMAINS = [
  { id: 'foundation', zh: '基础理论', desc: '基本概念、原理、源流、术语定义', kw: ['基础', '原理', '概念', '源流', '概述', '入门', '总论', '绪论'] },
  { id: 'method', zh: '方法操作', desc: '起局/排盘/起卦/装卦/推断的步骤与规则', kw: ['起局', '排盘', '起卦', '装卦', '推断', '方法', '步骤', '起例', '布局', '定局'] },
  { id: 'interpretation', zh: '象意断辞', desc: '各类象意、断辞、释义、吉凶判断', kw: ['象意', '断辞', '断语', '吉凶', '释义', '主', '应', '所主'] },
  { id: 'cases', zh: '案例', desc: '命例、卦例、盘例、实占记录', kw: ['命例', '卦例', '占例', '实例', '案'] },
  { id: 'reference', zh: '口诀图表', desc: '歌赋口诀、表格、查表、速查', kw: ['歌诀', '口诀', '歌赋', '赋', '诀', '图表', '查表'] },
  { ...GENERAL_DOMAIN },
];

/** Pull a sample of ##/### headings across a corpus's cleaned books (for taxonomy). */
export async function gatherHeadingSamples(corpus, files, max = 140) {
  const seen = new Set();
  for (const f of files) {
    let raw;
    try { raw = await readFile(join(corpus.cleanedDir, f), 'utf-8'); } catch (_) { continue; }
    for (const line of raw.split('\n')) {
      const m = line.match(/^#{2,3}\s+(.+)/);
      if (m) {
        const h = m[1].trim().slice(0, 40);
        if (h && !seen.has(h)) seen.add(h);
        if (seen.size >= max) break;
      }
    }
    if (seen.size >= max) break;
  }
  return [...seen];
}

/** Ask the LLM to propose a domain taxonomy for an arbitrary subject from its headings. */
export async function proposeDomains(model, msgs, corpus, headings) {
  const { SystemMessage, HumanMessage } = msgs;
  const sys = `你在为「${corpus.name}」这一中文术数/玄学/命理领域设计 RAG 知识库的**子领域分类法**。下面给你该领域若干书籍的章节标题样本。请据此提出 4~8 个**互斥、能覆盖该领域主要内容**的子领域：
- 每个给：英文小写连字符 id（如 method、cases、symbols）、中文名 zh、一句话说明 desc。
- 贴合本领域的实际内容与术语，不要套用占星词汇。
- 最后必须包含一个兜底项 {"id":"general","zh":"综合","desc":"其他/通用内容"}。
只输出一个 JSON 数组，元素形如 {"id":"...","zh":"...","desc":"..."}，不要任何多余文字。`;
  const res = await withRetry(() => model.invoke([
    new SystemMessage(sys),
    new HumanMessage(`章节标题样本（${headings.length} 条）：\n${headings.join('\n')}`),
  ]));
  const arr = parseJsonArray(extractText(res));
  if (!arr || !arr.length) return null;
  const out = [];
  const seen = new Set();
  for (const d of arr) {
    if (!d || typeof d.id !== 'string') continue;
    const id = d.id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, zh: d.zh || id, desc: d.desc || '', kw: [] });
  }
  if (!out.length) return null;
  if (!seen.has('general')) out.push({ ...GENERAL_DOMAIN });
  return out;
}

/**
 * Ensure corpus.domains is concrete. For generic (auto) corpora, discover the
 * taxonomy from the cleaned books via the LLM; fall back to GENERIC_DOMAINS when
 * no model. Mutates + returns the corpus. Call once per run before splitting.
 */
export async function resolveDomains(model, msgs, corpus, files, { log = () => {} } = {}) {
  if (!corpus.auto && corpus.domains) return corpus;
  if (model) {
    const headings = await gatherHeadingSamples(corpus, files);
    if (headings.length >= 4) {
      try {
        const proposed = await proposeDomains(model, msgs, corpus, headings);
        if (proposed) {
          corpus.domains = proposed;
          corpus.auto = false;
          log(`  ✓ 自动归纳子领域: ${proposed.map((d) => d.id).join(', ')}`);
          return corpus;
        }
      } catch (e) { log(`  ⚠ 子领域自动归纳失败(${e.message})，改用通用分类`); }
    }
  }
  corpus.domains = GENERIC_DOMAINS.map((d) => ({ ...d }));
  corpus.auto = false;
  log(`  · 使用通用子领域: ${corpus.domains.map((d) => d.id).join(', ')}`);
  return corpus;
}

/** Build the classification system prompt from a corpus's domains. */
export function classifySystemPrompt(corpus) {
  const lines = corpus.domains.map((d) => `- ${d.id}：${d.desc}`).join('\n');
  return `你是「${corpus.name}」知识分类助手。给你若干文本片段（编号 + 标题 + 摘要），判断每段**主要**属于下列哪个领域，只能使用给定的英文 id：
${lines}
只输出一个 JSON 数组，元素形如 {"i":<编号>,"domain":"<id>"}，不要任何多余文字或解释。`;
}

function parseTitleAndBody(raw) {
  const lines = String(raw).split('\n');
  let title = '';
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#\s+(.+)/);
    if (m) { title = m[1].trim(); start = i + 1; break; }
  }
  if (!title) title = 'untitled';
  return { title, body: lines.slice(start).join('\n') };
}

/** Drop the generic overview line Stage 1 prepends, so it isn't routed as content. */
function stripBoilerplate(body) {
  return body.replace(/^\s*本文档由《[^》]*》OCR[^\n]*\n?/, '').replace(/^\s+/, '');
}

/**
 * Split a cleaned book body into classification units: primarily on ##/### head-
 * ings, then capping size by paragraph and merging tiny heading-less fragments.
 */
export function splitIntoSegments(body) {
  const lines = body.split('\n');
  const raw = [];
  let cur = { heading: '', lines: [] };
  const push = () => {
    const text = cur.lines.join('\n').trim();
    if (text) raw.push({ heading: cur.heading, text });
  };
  for (const line of lines) {
    if (/^#{2,3}\s+/.test(line)) {
      push();
      cur = { heading: line.replace(/^#{2,3}\s+/, '').trim(), lines: [line] };
    } else {
      cur.lines.push(line);
    }
  }
  push();

  const sized = [];
  for (const s of raw) {
    if (s.text.length <= SEG_CHARS) { sized.push(s); continue; }
    const paras = s.text.split(/\n\s*\n/);
    let buf = [];
    let len = 0;
    const flush = () => {
      if (buf.length) sized.push({ heading: s.heading, text: buf.join('\n\n').trim() });
      buf = []; len = 0;
    };
    for (const p of paras) {
      if (len && len + p.length > SEG_CHARS) flush();
      buf.push(p); len += p.length + 2;
    }
    flush();
  }

  const merged = [];
  for (const s of sized) {
    if (merged.length && !s.heading && s.text.length < MIN_SEG_CHARS) {
      merged[merged.length - 1].text += `\n\n${s.text}`;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

/** Deterministic keyword fallback over a corpus's domains. */
export function heuristicDomain(seg, domains) {
  const hay = `${seg.heading}\n${seg.heading}\n${seg.text}`;
  let best = 'general';
  let bestScore = 0;
  for (const d of domains) {
    if (!d.kw || !d.kw.length) continue;
    let score = 0;
    for (const k of d.kw) {
      let from = 0;
      let count = 0;
      while ((from = hay.indexOf(k, from)) !== -1) { count++; from += k.length; }
      if (count) score += count * (k.length >= 3 ? 2 : 1);
    }
    if (score > bestScore) { bestScore = score; best = d.id; }
  }
  return bestScore > 0 ? best : 'general';
}

async function classifyBatch(model, msgs, corpus, valid, systemPrompt, batch) {
  if (!model) return batch.map((s) => heuristicDomain(s, corpus.domains));
  const { SystemMessage, HumanMessage } = msgs;
  const body = batch
    .map((s, i) => `[${i}] 标题：${s.heading || '（无）'}\n摘要：${s.text.replace(/\s+/g, ' ').slice(0, 220)}`)
    .join('\n\n');
  try {
    const res = await withRetry(() => model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(body),
    ]));
    const arr = parseJsonArray(extractText(res));
    const map = new Map();
    if (arr) {
      for (const it of arr) {
        if (it && Number.isInteger(it.i) && valid.has(it.domain)) map.set(it.i, it.domain);
      }
    }
    return batch.map((s, i) => map.get(i) || heuristicDomain(s, corpus.domains));
  } catch (_) {
    return batch.map((s) => heuristicDomain(s, corpus.domains));
  }
}

/** Classify all segments via batched LLM calls (with heuristic fallback). */
export async function classifySegments(model, msgs, corpus, segments, { log = () => {} } = {}) {
  const valid = new Set(corpus.domains.map((d) => d.id));
  const systemPrompt = classifySystemPrompt(corpus);
  const batches = [];
  for (let i = 0; i < segments.length; i += CLASSIFY_BATCH) batches.push(segments.slice(i, i + CLASSIFY_BATCH));
  let done = 0;
  const results = await mapWithConcurrency(batches, CLASSIFY_CONCURRENCY, async (batch) => {
    const labels = await classifyBatch(model, msgs, corpus, valid, systemPrompt, batch);
    done += batch.length;
    log(`    └ 分类 ${done}/${segments.length}`);
    return labels;
  });
  return results.flat();
}

/** Safe filename from a book title (keep Chinese, strip path-hostile chars). */
function slugifyBook(title) {
  return title.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '').trim() || 'book';
}

function renderDomainFile(corpus, title, domain, segs) {
  const def = corpus.domains.find((d) => d.id === domain);
  const zh = (def && def.zh) || domain;
  const head = `<!-- domain: ${domain} -->\n# ${title} · ${zh}\n\n> 来源：《${title}》 ｜ 领域：${corpus.name}·${zh}\n`;
  return `${head}\n${segs.map((s) => s.text).join('\n\n')}\n`;
}

export async function listCleanedFiles(corpus) {
  if (!existsSync(corpus.cleanedDir)) return [];
  const files = await readdir(corpus.cleanedDir);
  return files.filter((f) => f.endsWith('.md')).sort();
}

/**
 * Split one cleaned book into per-domain files under the corpus's output dir.
 * Returns stats incl. a content-preservation check (output chars vs input chars).
 */
export async function splitCleanedFile(model, msgs, corpus, filename, { log = () => {} } = {}) {
  const valid = new Set(corpus.domains.map((d) => d.id));
  const raw = await readFile(join(corpus.cleanedDir, filename), 'utf-8');
  const { title, body } = parseTitleAndBody(raw);
  const segments = splitIntoSegments(stripBoilerplate(body));
  if (!segments.length) return { title, segments: 0, outputs: [], inputChars: 0, outputChars: 0 };

  log(`  · ${title}: ${segments.length} 段，分类中…`);
  const domains = await classifySegments(model, msgs, corpus, segments, { log });

  const buckets = new Map();
  segments.forEach((s, i) => {
    const d = valid.has(domains[i]) ? domains[i] : 'general';
    if (!buckets.has(d)) buckets.set(d, []);
    buckets.get(d).push(s);
  });

  if (!existsSync(corpus.outDir)) await mkdir(corpus.outDir, { recursive: true });
  const slug = slugifyBook(title);
  const outputs = [];
  for (const [domain, segs] of buckets) {
    const outName = `${corpus.id}-${slug}-${domain}.md`;
    await writeFile(join(corpus.outDir, outName), renderDomainFile(corpus, title, domain, segs), 'utf-8');
    outputs.push({ domain, outName, segs: segs.length, chars: segs.reduce((a, s) => a + s.text.length, 0) });
  }

  const inputChars = segments.reduce((a, s) => a + s.text.length, 0);
  const outputChars = outputs.reduce((a, o) => a + o.chars, 0);
  return { title, segments: segments.length, outputs, inputChars, outputChars };
}
