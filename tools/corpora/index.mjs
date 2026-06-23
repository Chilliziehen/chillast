// corpora/index.mjs — registry of knowledge "corpora" (subject domains).
//
// A corpus is identified by an id. If tools/corpora/<id>.mjs exists, it provides a
// curated config (domains taxonomy + optional cleaning hints). If it does NOT
// exist, ANY id still works via a generic profile whose domains are auto-discovered
// by the LLM at split time — so introducing a brand-new kind of esoteric literature
// (大六壬 / 易学 / 撼龙经 / 梅花易数 …) needs ZERO config: just drop the OCR files in
// tools/raw-knowledge/<id>/ and run the tools with --corpus <id>.

import { join } from 'path';

const ROOT = process.cwd();

// Curated corpora (have a tuned config file). Any other id also works (generic).
export const CORPUS_IDS = ['astrology', 'bazi', 'ziwei', 'vedic'];

const GENERAL_DOMAIN = { id: 'general', zh: '综合', desc: '导论、概述、历史、源流、方法论等通用内容', kw: [] };

/** Astrology keeps the legacy flat dirs; everything else is isolated under <id>/. */
function dirsFor(id) {
  if (id === 'astrology') {
    return { rawDir: join(ROOT, 'tools', 'raw-knowledge'), cleanedDir: join(ROOT, 'tools', 'cleaned') };
  }
  return {
    rawDir: join(ROOT, 'tools', 'raw-knowledge', id),
    cleanedDir: join(ROOT, 'tools', 'cleaned', id),
  };
}

export async function loadCorpus(id, opts = {}) {
  const cid = id || 'astrology';

  let cfg = null;
  try {
    const mod = await import(`./${cid}.mjs`);
    cfg = mod.default || mod;
  } catch (_) {
    cfg = null; // no config file → generic, auto-domain profile
  }

  const name = (cfg && cfg.name) || opts.name || cid;
  const clean = (cfg && cfg.clean) || {};

  let domains;
  let auto;
  if (cfg && Array.isArray(cfg.domains) && cfg.domains.length) {
    domains = cfg.domains.slice();
    if (!domains.some((d) => d.id === 'general')) domains.push({ ...GENERAL_DOMAIN });
    auto = false;
  } else {
    // Generic: the domain taxonomy is discovered by the LLM at split time.
    domains = null;
    auto = true;
  }

  return { id: cid, name, clean, domains, auto, ...dirsFor(cid), outDir: join(ROOT, 'assets', 'knowledge', 'builtin') };
}

export { GENERAL_DOMAIN };
