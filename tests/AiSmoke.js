'use strict';

const ModelProvider = require('../src/core/ai/ModelProvider');

async function main() {
  const mp = new ModelProvider();
  const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('SKIP: No OPENAI_API_KEY or ANTHROPIC_API_KEY env var set');
    console.log('To test: set OPENAI_API_KEY=sk-... and re-run');
    process.exit(0);
  }
  const provider = process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai';
  const model = provider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001';
  await mp.configure({ provider, model, apiKey, temperature: 0 });
  console.log('ModelProvider configured:', mp.isConfigured());

  const llm = mp.chatModel();
  const resp = await llm.invoke([{ role: 'user', content: 'Reply with exactly one word: hello' }]);
  console.log('LLM response:', resp.content);
  if (!resp.content) { console.error('FAIL: empty response'); process.exit(1); }
  console.log('PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
