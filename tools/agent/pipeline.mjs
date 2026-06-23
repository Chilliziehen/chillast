// pipeline.mjs — Stage 1: deterministic, chunked, near-lossless OCR cleaning.
//
// Corpus-driven: the subject-specific cleaning instructions come from a corpus
// config (tools/corpora/<id>.mjs), so the same engine cleans astrology, bazi,
// ziwei, vedic … books. Input/output dirs also come from the corpus.
//
// Why chunked? Asking an LLM to read a whole book and re-emit it in one turn
// forces summarization (and is capped by the output token limit). We split each
// file into small chunks, clean each independently with a strict "preserve
// everything" instruction, then stitch — so the model never drops most content.

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { extractText, stripFence, mapWithConcurrency, withRetry } from './util.mjs';

// Per-chunk size (characters of raw OCR text) and parallelism.
export const CHUNK_CHARS = Number(process.env.CLEAN_CHUNK_CHARS || 4500);
export const CONCURRENCY = Number(process.env.CLEAN_CONCURRENCY || 4);

// Universal cleaning prompt — works for ANY Chinese 术数/玄学/命理/神秘学 literature
// (占星、八字、紫微、大小六壬、易学、堪舆/撼龙经、择日、梅花易数、天文历法、周易…).
const UNIVERSAL_CLEAN_PROMPT = `你是中文术数 / 玄学 / 命理 / 神秘学古籍的 OCR 文本清洗专家。下面给你的是从一本这类书籍中 OCR 提取的**一段**原始纯文本（整本书的一部分）。请把它清洗成规范的简体中文 Markdown。

【第一原则：这是清洗，不是摘要】
- 逐句保留原文的**全部实质内容**，禁止概括、缩写、改写、删减或省略任何正文。
- 不要因为"看起来重复"就删除正文——不同段落的相似论述都要保留。
- 清洗后的中文正文字数应与输入正文相当（通常 ≥ 输入正文的 90%）。宁可多保留，也不要丢内容。

【需要修复的 OCR 问题】
- 删除：纯乱码片段（如 {l hmrt {ee）、页眉页脚、孤立页码、纯英文/无意义的版权与目录噪声。
- 修正：明显错字、被错误拆分或粘连的词（依上下文判断，不确定就保留原样，绝不臆改专业术语与数据）。
- 合并：被错误断行 / 分页切断的句子和段落，恢复成通顺的整段。
- **保留一切专业内容与符号**：卦象 / 爻辞 / 卦名、天干地支、五行十神、神煞、星座 / 宫位 / 相位及其符号（☉ ☽ ☿ ♀ ♂ ♃ ♄ ♅ ♆ ♇ 等）、二十八宿、口诀歌赋、命例 / 卦例 / 盘例、古文引文、表格与数字数据。看不懂也不要删改。

【格式要求】
- 若本段中出现章节或小节标题，用 ## / ### 还原；正文用普通段落；原文的表格尽量用 Markdown 表格或保持其行列结构。
- 不要新增原文没有的标题、解释或总结。
- 直接输出清洗后的 Markdown 正文本身，不要任何前言、说明、不要用 \`\`\` 代码块包裹，不要写"以下是清洗结果"之类的话。

【特例】
- 如果这一段几乎全是乱码、版权页、目录或空白、没有任何实质正文，只回复一个词：SKIP`;

/** Build the per-chunk cleaning system prompt. Universal by default; a corpus may
 *  append an optional领域提示 (clean.preserve) to bias term preservation. */
export function cleanSystemPrompt(corpus) {
  const c = (corpus && corpus.clean) || {};
  const name = (corpus && corpus.name) || '';
  if (name || c.preserve) {
    const extra = c.preserve ? `尤其注意完整保留：${c.preserve}。` : '';
    return `${UNIVERSAL_CLEAN_PROMPT}\n\n【本书领域提示】本书属于「${name || '术数/玄学'}」领域。${extra}`;
  }
  return UNIVERSAL_CLEAN_PROMPT;
}

/**
 * Split text into chunks of at most ~maxChars, breaking on blank-line paragraph
 * boundaries so we never cut mid-sentence. Oversized single paragraphs are hard
 * split as a fallback.
 */
export function splitIntoChunks(text, maxChars = CHUNK_CHARS) {
  const paragraphs = String(text).split(/\n\s*\n/);
  const chunks = [];
  let buf = '';
  const flush = () => { if (buf.trim()) chunks.push(buf); buf = ''; };

  for (const para of paragraphs) {
    const p = para.replace(/\s+$/g, '');
    if (!p.trim()) continue;
    if (p.length > maxChars) {
      flush();
      for (let i = 0; i < p.length; i += maxChars) chunks.push(p.slice(i, i + maxChars));
      continue;
    }
    if (buf && buf.length + p.length + 2 > maxChars) flush();
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  flush();
  return chunks;
}

async function cleanChunk(model, SystemMessage, HumanMessage, systemPrompt, chunk) {
  const res = await withRetry(() => model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(chunk),
  ]));
  const out = stripFence(extractText(res));
  if (/^skip$/i.test(out.trim())) return '';
  return out;
}

/** Derive a readable book title from the raw OCR filename. */
export function titleFromFilename(filename) {
  return filename
    .replace(/\.p\.txt$/i, '')
    .replace(/^\[OCR\]_?/i, '')
    .replace(/_\d{6,}(?:_\d{3,})?$/, '') // trailing _YYYYMMDD_HHMM timestamp
    .trim() || filename.replace(/\.p\.txt$/i, '');
}

/** List the raw .p.txt OCR files for a corpus. */
export async function listRawFiles(corpus) {
  if (!existsSync(corpus.rawDir)) return [];
  const files = await readdir(corpus.rawDir);
  return files.filter((f) => /\.p\.txt$/i.test(f)).sort();
}

/**
 * Clean a single raw file end-to-end and write the result to the corpus's
 * cleaned dir. Returns stats so the caller can verify content preservation.
 * Skips files already cleaned unless { force } is set.
 */
export async function cleanFile(model, messages, corpus, filename, { log = () => {}, force = false } = {}) {
  const { SystemMessage, HumanMessage } = messages;
  const title = titleFromFilename(filename);
  const outName = `${title}.md`;
  const outPath = join(corpus.cleanedDir, outName);

  if (!force && existsSync(outPath)) {
    log(`  · 跳过（已存在）：${outName}（用 --force 重新清洗）`);
    return { title, outName, skipped: true };
  }

  const raw = await readFile(join(corpus.rawDir, filename), 'utf-8');
  const chunks = splitIntoChunks(raw);
  const systemPrompt = cleanSystemPrompt(corpus);
  log(`  · ${title}: ${raw.length} 字符 → ${chunks.length} 块（并发 ${CONCURRENCY}）`);

  let done = 0;
  const cleaned = await mapWithConcurrency(chunks, CONCURRENCY, async (chunk, idx) => {
    try {
      const out = await cleanChunk(model, SystemMessage, HumanMessage, systemPrompt, chunk);
      done++;
      log(`    └ 块 ${idx + 1}/${chunks.length} ✓ (${done}/${chunks.length})`);
      return out;
    } catch (e) {
      done++;
      log(`    └ 块 ${idx + 1}/${chunks.length} ✗ ${e.message}（保留原文）`);
      return chunk; // keep raw so no content is silently lost
    }
  });

  const body = cleaned.filter((s) => s && s.trim()).join('\n\n');
  const overview = `本文档由《${title}》OCR 文本清洗整理而成，覆盖该书的${corpus.name}知识内容。`;
  const md = `# ${title}\n\n${overview}\n\n${body}\n`;

  if (!existsSync(corpus.cleanedDir)) await mkdir(corpus.cleanedDir, { recursive: true });
  await writeFile(outPath, md, 'utf-8');

  const ratio = raw.length ? Math.round((body.length / raw.length) * 100) : 0;
  return { title, outName, inputChars: raw.length, outputChars: body.length, chunks: chunks.length, ratio };
}
