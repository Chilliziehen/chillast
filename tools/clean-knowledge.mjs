#!/usr/bin/env node
//
// Stage 1 — OCR 文本清洗（分块·近无损·通用）。按 --corpus 指定知识领域。
// 输出整书 Markdown 到该领域的 cleaned 目录；之后 split-knowledge 按领域拆分。
//
// 用法:
//   node tools/clean-knowledge.mjs                       # astrology（默认）
//   node tools/clean-knowledge.mjs --corpus bazi         # 八字
//   node tools/clean-knowledge.mjs --corpus ziwei 关键词  # 只清洗文件名含关键词的
//   node tools/clean-knowledge.mjs --corpus vedic --force
//
// 环境变量: CLEAN_CHUNK_CHARS / CLEAN_CONCURRENCY / CLEAN_MAX_TOKENS / CLEAN_TEMPERATURE

import { loadConfig, createChatModel } from './agent/config.mjs';
import { listRawFiles, cleanFile, CHUNK_CHARS, CONCURRENCY } from './agent/pipeline.mjs';
import { loadCorpus } from './corpora/index.mjs';
import { parseArgs } from './agent/cli.mjs';

async function main() {
  const { corpusId, force, filter } = parseArgs(process.argv.slice(2));
  const corpus = await loadCorpus(corpusId);

  console.log('╔══════════════════════════════════════════════════╗');
  console.log(`║  数据清洗 Stage 1 · ${corpus.name.padEnd(28)}║`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  const config = await loadConfig();
  if (!config.apiKey) {
    console.error('✗ 未找到 API Key。请设置 OPENAI_API_KEY 环境变量，或在应用中配置 AI 设置。');
    process.exit(1);
  }
  console.log(`✓ 领域: ${corpus.id} | 原文目录: ${corpus.rawDir}`);
  console.log(`✓ LLM: ${config.provider} / ${config.model}`);
  console.log(`✓ 参数: chunk=${CHUNK_CHARS} · 并发=${CONCURRENCY} · maxTokens=${config.maxTokens} · temp=${config.temperature}\n`);

  const model = await createChatModel(config);
  const { SystemMessage, HumanMessage } = await import('@langchain/core/messages');

  let files = await listRawFiles(corpus);
  if (!files.length) {
    console.error(`✗ ${corpus.rawDir} 下没有 .p.txt 文件。请放入 OCR 纯文本。`);
    process.exit(1);
  }
  if (filter) {
    files = files.filter((f) => f.includes(filter));
    if (!files.length) { console.error(`✗ 没有文件名包含 "${filter}" 的 .p.txt 文件。`); process.exit(1); }
  }

  console.log(`📚 待清洗文件 (${files.length}):`);
  for (const f of files) console.log(`   - ${f}`);
  console.log('');

  const stats = [];
  for (const filename of files) {
    console.log(`🤖 清洗: ${filename}`);
    try {
      const s = await cleanFile(model, { SystemMessage, HumanMessage }, corpus, filename, {
        log: (m) => console.log(m), force,
      });
      stats.push(s);
      if (!s.skipped) console.log(`  ✓ 输出 ${corpus.cleanedDir}/${s.outName}: ${s.inputChars} → ${s.outputChars} 字符（保留率约 ${s.ratio}%）`);
      console.log('');
    } catch (e) {
      console.error(`  ✗ 失败: ${e.message}\n`);
    }
  }

  console.log('────────────────────────────────────────────────────');
  console.log('清洗汇总（保留率 = 输出正文 / 输入原文，越接近 100% 越无损）:');
  for (const s of stats) {
    if (s.skipped) { console.log(`  ${s.title}: (已存在，跳过)`); continue; }
    console.log(`  ${s.title}: ${s.ratio}%${s.ratio < 50 ? '  ⚠ 偏低，请检查' : ''}`);
  }
  console.log('────────────────────────────────────────────────────');
  console.log(`\n✓ Stage 1 完成。下一步：node tools/split-knowledge.mjs --corpus ${corpus.id}`);
}

main().catch((e) => { console.error('✗ 错误:', e.message); process.exit(1); });
