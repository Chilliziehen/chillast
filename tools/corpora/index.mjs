// corpora/index.mjs — registry of knowledge "corpora" (subject domains).
//
// Each corpus config (./<id>.mjs) declares only the subject-specific bits:
//   - name:   human label
//   - clean:  { subject, preserve, fixHint }  → OCR cleaning prompt inputs
//   - domains:[{ id, zh, desc, kw }]          → classification taxonomy
// Directories are derived from the id by convention (see below), so adding a new
// knowledge base = drop one config file in this folder.

import { join } from 'path';

const ROOT = process.cwd();

// Known corpora. Add an id here + a matching ./<id>.mjs to support a new subject.
export const CORPUS_IDS = ['astrology', 'bazi', 'ziwei', 'vedic'];

/**
 * Resolve directories for a corpus. Astrology keeps the legacy flat dirs for
 * back-compat; every other corpus is isolated under a <id>/ subfolder.
 */
function dirsFor(id) {
  if (id === 'astrology') {
    return {
      rawDir: join(ROOT, 'tools', 'raw-knowledge'),
      cleanedDir: join(ROOT, 'tools', 'cleaned'),
    };
  }
  return {
    rawDir: join(ROOT, 'tools', 'raw-knowledge', id),
    cleanedDir: join(ROOT, 'tools', 'cleaned', id),
  };
}

export async function loadCorpus(id) {
  const cid = id || 'astrology';
  if (!CORPUS_IDS.includes(cid)) {
    throw new Error(`未知知识领域 corpus: "${cid}"。可用: ${CORPUS_IDS.join(', ')}`);
  }
  let mod;
  try {
    mod = await import(`./${cid}.mjs`);
  } catch (e) {
    throw new Error(`加载 corpus "${cid}" 失败: ${e.message}`);
  }
  const c = mod.default || mod;
  if (!c.domains || !c.domains.length) throw new Error(`corpus "${cid}" 未定义 domains`);
  if (!c.domains.some((d) => d.id === 'general')) {
    c.domains.push({ id: 'general', zh: '综合', desc: '导论、概述、历史、方法论等通用内容', kw: [] });
  }
  return {
    id: cid,
    name: c.name || cid,
    clean: c.clean || {},
    domains: c.domains,
    ...dirsFor(cid),
    outDir: join(ROOT, 'assets', 'knowledge', 'builtin'),
  };
}
