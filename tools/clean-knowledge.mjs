#!/usr/bin/env node

import { loadConfig, createChatModel } from './agent/config.mjs';
import { allTools } from './agent/tools.mjs';
import { SYSTEM_PROMPT } from './agent/prompt.mjs';

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     占星知识库数据清洗 Agent                      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // Load LLM config
  const config = await loadConfig();
  if (!config.apiKey) {
    console.error('✗ 未找到 API Key。请设置 OPENAI_API_KEY 环境变量，或在应用中配置 AI 设置。');
    process.exit(1);
  }
  console.log(`✓ LLM: ${config.provider} / ${config.model}\n`);

  // Create chat model
  const model = await createChatModel(config);

  // Create LangGraph ReAct agent
  const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
  const agent = createReactAgent({
    llm: model,
    tools: allTools,
    prompt: SYSTEM_PROMPT,
  });

  // Run agent
  console.log('🤖 Agent 启动，开始清洗文档...\n');

  const userInput = process.argv[2] || '请清洗 tools/raw-knowledge/ 目录中的所有文档，按照知识库格式规范输出到 assets/knowledge/builtin/ 目录。';

  const { HumanMessage } = await import('@langchain/core/messages');

  const stream = await agent.stream(
    { messages: [new HumanMessage(userInput)] },
    { streamMode: ['messages', 'updates'], recursionLimit: 50 },
  );

  for await (const chunk of stream) {
    const [mode, payload] = chunk;

    if (mode === 'messages') {
      const msg = Array.isArray(payload) ? payload[0] : payload;
      if (msg && msg._getType && msg._getType() === 'ai') {
        const text = typeof msg.content === 'string'
          ? msg.content
          : (Array.isArray(msg.content) ? msg.content.map(p => p.text || '').join('') : '');
        if (text) {
          process.stdout.write(text);
        }
      }
    } else if (mode === 'updates') {
      for (const node of Object.keys(payload || {})) {
        const msgs = (payload[node] && payload[node].messages) || [];
        for (const m of msgs) {
          if (m._getType && m._getType() === 'ai' && m.tool_calls && m.tool_calls.length) {
            for (const tc of m.tool_calls) {
              console.log(`\n⚙ 调用工具: ${tc.name}`);
            }
          } else if (m._getType && m._getType() === 'tool') {
            const text = typeof m.content === 'string' ? m.content : '';
            const preview = text.slice(0, 80);
            console.log(`  └ ${preview}${text.length > 80 ? '...' : ''}\n`);
          }
        }
      }
    }
  }

  console.log('\n✓ 清洗完成。请检查 assets/knowledge/builtin/ 目录中的输出文件。');
  console.log('  提示：删除 userData/data/vector-index/ 目录以强制重建向量索引。');
}

main().catch((e) => {
  console.error('✗ 错误:', e.message);
  process.exit(1);
});
