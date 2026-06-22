#!/usr/bin/env node
//
// 保守去噪 — 删除 tools/cleaned/*.md 里高置信的"图书信息/OCR 噪声"：
//   - 单独成行的页码数字（如 166 / 001 / 02）
//   - 与书名完全相同的页眉行（运行头）
//   - 目录标题行（"目录"/"目錄"）
//   - 短的版权/ISBN/出版/责编/定价/版次/开本/印刷 等元数据行（≤50 字）
// 不动序/前言/作者简介等正文（交给 Stage 2 的 general 桶兜底）。
//
// 默认 dry-run（只预览不改）。确认后加 --apply 才写回。按 --corpus 指定领域。
//   node tools/denoise-cleaned.mjs                         # astrology 预览
//   node tools/denoise-cleaned.mjs --corpus bazi --apply   # 八字 应用（先备份到 <cleaned>/.orig/）
//   node tools/denoise-cleaned.mjs --corpus ziwei 关键词    # 只处理文件名匹配的

import { readFile, writeFile, mkdir, readdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { loadCorpus } from './corpora/index.mjs';
import { parseArgs } from './agent/cli.mjs';

// Strict metadata markers — a short line containing any of these is colophon/junk.
// (Book-info noise is subject-agnostic, so denoise rules are shared across corpora.)
const META_RE = /(ISBN|图书在版编目|圖書在版編目|责任编辑|責任編輯|责任印制|責任印製|责任校对|責任校對|出版发行|出版發行|出版社|版权所有|版權所有|翻印必究|定价|定價|版次|印次|开本|開本|新华书店|裝幀|装帧|印刷)/;

function titleOf(content) {
  const line = content.split('\n').find((l) => /^#\s+/.test(l));
  return line ? line.replace(/^#\s+/, '').trim() : '';
}

function denoise(content) {
  const title = titleOf(content);
  const lines = content.split('\n');
  const kept = [];
  const removed = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (/^#\s+/.test(line)) { kept.push(line); continue; } // never drop the markdown title

    let drop = false;
    if (/^\d{1,4}$/.test(t)) drop = true;                              // bare page number
    else if (title && t === title) drop = true;                        // running header = book title
    else if (t === '目录' || t === '目錄' || t === '目 录') drop = true;  // TOC header
    else if (t.length <= 50 && META_RE.test(t)) drop = true;           // short colophon line

    if (drop) { if (t) removed.push(t); continue; }
    kept.push(line);
  }
  const out = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  return { out, removed, title };
}

async function main() {
  const { corpusId, apply, filter } = parseArgs(process.argv.slice(2));
  const corpus = await loadCorpus(corpusId);
  const DIR = corpus.cleanedDir;
  const ORIG = join(DIR, '.orig');

  if (!existsSync(DIR)) { console.error(`✗ 目录不存在: ${DIR}`); process.exit(1); }
  let files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
  if (filter) files = files.filter((f) => f.includes(filter));
  if (!files.length) { console.error('✗ 没有匹配的 .md 文件。'); process.exit(1); }

  console.log(apply ? '🧹 去噪（写回模式）\n' : '🔍 去噪（预览模式，不写回；确认后加 --apply）\n');

  const reportLines = [];
  let totalRemoved = 0;
  for (const f of files) {
    const path = join(DIR, f);
    const content = await readFile(path, 'utf-8');
    const { out, removed } = denoise(content);
    totalRemoved += removed.length;
    const before = content.length;
    const after = out.length;
    console.log(`  ${f}: 删除 ${removed.length} 行，${before}→${after} 字（-${before - after}）`);
    if (removed.length) {
      reportLines.push(`\n===== ${f}（删除 ${removed.length} 行）=====`);
      reportLines.push(...removed.map((l) => `  - ${l}`));
    }
    if (apply && removed.length) {
      if (!existsSync(ORIG)) await mkdir(ORIG, { recursive: true });
      const backup = join(ORIG, f);
      if (!existsSync(backup)) await copyFile(path, backup); // one-time original backup
      await writeFile(path, out, 'utf-8');
    }
  }

  // Always write the removed-lines report so nothing is silently lost.
  const reportPath = join(DIR, '_denoise-report.txt');
  await writeFile(reportPath, `去噪报告（共删除 ${totalRemoved} 行）\n${reportLines.join('\n')}\n`, 'utf-8');

  console.log('────────────────────────────────────────────────────');
  console.log(`共删除 ${totalRemoved} 行。明细见 ${reportPath}`);
  if (apply) {
    console.log(`已写回；原文备份在 ${ORIG}。`);
    console.log(`下一步：node tools/split-knowledge.mjs --corpus ${corpus.id}`);
  } else {
    console.log(`这是预览。确认无误后运行：node tools/denoise-cleaned.mjs --corpus ${corpus.id} --apply`);
  }
}

main().catch((e) => { console.error('✗ 错误:', e.message); process.exit(1); });
