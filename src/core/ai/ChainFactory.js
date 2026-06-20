'use strict';

const esm = require('./esm-bridge');
const { build: buildInterpretPrompt } = require('./prompts/InterpretPrompt');
const { build: buildChatPrompt } = require('./prompts/ChatPrompt');

class ChainFactory {
  constructor(modelProvider, knowledgeBase) {
    this._mp = modelProvider;
    this._kb = knowledgeBase;
  }

  async _getRagContext(query, k = 6) {
    if (!this._kb || !this._kb.isReady()) return '';
    const docs = await this._kb.retrieve(query, k);
    if (!docs.length) return '';
    return docs.map((d, i) => `[参考${i + 1}] ${d.content}`).join('\n\n');
  }

  /**
   * Build a streaming interpretation (no tool calling).
   * Returns an async iterable of AIMessageChunk.
   */
  async buildInterpretStream(chartText, chartType, signal) {
    const model = this._mp.chatModel();
    const ragContext = await this._getRagContext(chartText);
    const { systemMessage, humanMessage } = buildInterpretPrompt(chartText, ragContext, chartType);

    const { HumanMessage, SystemMessage } = await esm.load('@langchain/core/messages');
    const messages = [
      new SystemMessage(systemMessage),
      new HumanMessage(humanMessage),
    ];

    return model.stream(messages, signal ? { signal } : undefined);
  }

  /**
   * Build a chat model with tools bound (if any).
   * The caller (AiService) handles the tool-calling loop.
   * Returns { model, systemPrompt, tools } so AiService can manage the conversation.
   */
  async prepareChatModel(currentChartContext, tools) {
    let model = this._mp.chatModel();
    const systemPrompt = buildChatPrompt(currentChartContext);

    // Add RAG as a tool if knowledge base is ready
    if (this._kb && this._kb.isReady()) {
      const { DynamicStructuredTool } = await esm.load('@langchain/core/tools');
      const z = require('zod');
      const kb = this._kb;
      const ragTool = new DynamicStructuredTool({
        name: 'search_knowledge',
        description: '搜索占星知识库，查找关于某个占星或命理主题的专业知识。用中文关键词搜索。',
        schema: z.object({ query: z.string().describe('搜索关键词，如"太阳在白羊座"') }),
        func: async (input) => {
          const docs = await kb.retrieve(input.query, 4);
          return docs.map((d) => d.content).join('\n\n') || '未找到相关知识';
        },
      });
      tools = [...(tools || []), ragTool];
    }

    if (tools && tools.length > 0) {
      model = model.bindTools(tools);
    }

    return { model, systemPrompt, tools: tools || [] };
  }
}

module.exports = ChainFactory;
