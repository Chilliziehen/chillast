'use strict';

const ToolProvider = require('./ToolProvider');
const esm = require('../esm-bridge');

/**
 * WebSearchToolProvider — gives the agent live internet access via two tools:
 *   - web_search   : query the web, return title + url + snippet for top results
 *   - read_webpage : fetch a URL and return its text (HTML stripped)
 *
 * Backend is configurable (settings.search):
 *   { provider: 'bing' (default, no key, 国内可达) | 'duckduckgo' | 'tavily'
 *               | 'searxng' | 'none',
 *     apiKey, endpoint, maxResults }
 * bing/duckduckgo need no key; tavily needs apiKey; searxng needs a self-hosted
 * endpoint. Default is Bing (cn.bing.com) because DuckDuckGo is blocked in mainland
 * China. Runs in the main process where global fetch is available.
 */
class WebSearchToolProvider extends ToolProvider {
  constructor(config) {
    super('web', 'web');
    this._cfg = config || {};
  }

  _provider() { return (this._cfg.provider || 'bing').toLowerCase(); }
  _apiKey() { return this._cfg.apiKey || process.env.TAVILY_API_KEY || ''; }

  isReady() {
    const p = this._provider();
    if (p === 'none') return false;
    if (p === 'tavily') return !!this._apiKey();
    if (p === 'searxng') return !!this._cfg.endpoint;
    return true; // bing / duckduckgo — no key needed
  }

  async _build() {
    if (!this.isReady()) return [];
    const { DynamicStructuredTool } = await esm.load('@langchain/core/tools');
    const z = require('zod');
    const cfg = this._cfg;
    const apiKey = this._apiKey();
    const provider = this._provider();
    const defaultLimit = Number(cfg.maxResults) || 5;

    const webSearch = new DynamicStructuredTool({
      name: 'web_search',
      description:
        '联网搜索互联网，获取**实时/最新**信息或内置知识库未覆盖的外部事实（如近期天象的确切日期、新闻、人物资料、某概念的网络资料）。返回若干条「标题 + 网址 + 摘要」。注意：占星/命理的解读类问题应优先用 search_knowledge 查内置知识库；本工具用于时效性或知识库之外的事实。',
      schema: z.object({
        query: z.string().describe('搜索关键词'),
        limit: z.number().int().min(1).max(10).optional().describe('返回结果条数（默认 5）'),
      }),
      func: async (input) => {
        const n = input.limit || defaultLimit;
        try {
          const results = await runSearch(provider, { apiKey, endpoint: cfg.endpoint }, input.query, n);
          if (!results.length) return '未找到相关网页结果。';
          return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
        } catch (e) {
          return `联网搜索失败：${e.message}`;
        }
      },
    });

    const readWebpage = new DynamicStructuredTool({
      name: 'read_webpage',
      description:
        '抓取指定网址的正文文本（已去除 HTML/脚本）。在 web_search 找到有价值的链接后，用本工具阅读其详细内容。输入完整 URL（含 http(s)://）。',
      schema: z.object({ url: z.string().describe('完整网址，例如 https://example.com/article') }),
      func: async (input) => {
        try {
          return await fetchText(input.url);
        } catch (e) {
          return `网页抓取失败：${e.message}`;
        }
      },
    });

    return [webSearch, readWebpage];
  }
}

// ── search backends ────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchWithTimeout(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      // Accept-Language is required: cookieless requests without it get a degraded
      // / off-topic results page from Bing.
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', ...(opts.headers || {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

function runSearch(provider, cfg, query, n) {
  if (provider === 'tavily') return tavilySearch(cfg, query, n);
  if (provider === 'searxng') return searxngSearch(cfg, query, n);
  if (provider === 'duckduckgo') return duckduckgoSearch(query, n);
  return bingSearch(query, n); // default
}

async function bingSearch(query, n) {
  const res = await fetchWithTimeout(`https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN`);
  if (!res.ok) throw new Error(`Bing HTTP ${res.status}`);
  return parseBing(await res.text(), n);
}

function parseBing(html, n) {
  const results = [];
  const blockRe = /<li class="b_algo"[\s\S]*?(?=<li class="b_algo"|<\/ol>|$)/g;
  let block;
  while ((block = blockRe.exec(html)) && results.length < n) {
    const seg = block[0];
    const a = seg.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const snip = seg.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    results.push({ title: stripTags(a[2]), url: a[1], snippet: snip ? stripTags(snip[1]) : '' });
  }
  return results;
}

async function tavilySearch(cfg, query, n) {
  const res = await fetchWithTimeout('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: cfg.apiKey, query, max_results: n, search_depth: 'basic' }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).slice(0, n).map((r) => ({ title: r.title || '', url: r.url || '', snippet: (r.content || '').slice(0, 300) }));
}

async function searxngSearch(cfg, query, n) {
  const base = String(cfg.endpoint || '').replace(/\/$/, '');
  const res = await fetchWithTimeout(`${base}/search?q=${encodeURIComponent(query)}&format=json`);
  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).slice(0, n).map((r) => ({ title: r.title || '', url: r.url || '', snippet: (r.content || '').slice(0, 300) }));
}

async function duckduckgoSearch(query, n) {
  const res = await fetchWithTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  return parseDuckDuckGo(await res.text(), n);
}

function parseDuckDuckGo(html, n) {
  const snippets = [];
  const snipRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let sm;
  while ((sm = snipRe.exec(html))) snippets.push(stripTags(sm[1]));
  const results = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  let i = 0;
  while ((m = re.exec(html)) && results.length < n) {
    results.push({ title: stripTags(m[2]), url: decodeDdgUrl(m[1]), snippet: snippets[i] || '' });
    i += 1;
  }
  return results;
}

function decodeDdgUrl(href) {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch (_) { /* fall through */ } }
  return href.startsWith('//') ? `https:${href}` : href;
}

async function fetchText(url) {
  const res = await fetchWithTimeout(url, {}, 15000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  let body = await res.text();
  if (/application\/json/.test(ct)) return body.slice(0, 8000);
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const text = stripTags(body).slice(0, 8000);
  return text || '(页面无可提取文本)';
}

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&nbsp;|&ensp;|&emsp;|&thinsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
}

function cp(n) { try { return String.fromCodePoint(n); } catch (_) { return ''; } }

module.exports = WebSearchToolProvider;
