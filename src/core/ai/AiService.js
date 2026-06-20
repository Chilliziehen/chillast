'use strict';

const ModelProvider = require('./ModelProvider');
const KnowledgeBase = require('./KnowledgeBase');
const ChainFactory = require('./ChainFactory');
const { createTools } = require('./AstroToolkit');
const { toText } = require('./prompts/ChartSerializer');
const esm = require('./esm-bridge');

class AiService {
  constructor(astrologyService, chineseAstrologyService) {
    this._astrology = astrologyService;
    this._chinese = chineseAstrologyService;
    this._mp = new ModelProvider();
    this._kb = null;
    this._chainFactory = null;
    this._tools = [];
    this._configured = false;
    this._abortControllers = new Map();
    this._context = null;
  }

  async configure(settings) {
    await this._mp.configure(settings);

    this._kb = new KnowledgeBase(this._mp);
    if (settings.knowledgeBuiltinPath) {
      await this._kb.initialize(settings.knowledgeBuiltinPath, settings.knowledgeUserPath || null);
    }

    this._chainFactory = new ChainFactory(this._mp, this._kb);
    this._tools = await createTools(this._astrology, this._chinese, this);
    this._configured = true;
  }

  status() {
    return {
      configured: this._configured,
      provider: (this._mp._settings && this._mp._settings.provider) || '',
      model: (this._mp._settings && this._mp._settings.model) || '',
      baseUrl: (this._mp._settings && this._mp._settings.baseUrl) || '',
      knowledgeDocCount: this._kb ? this._kb.listDocuments().length : 0,
    };
  }

  async testConnection() {
    if (!this._configured) throw new Error('AI 服务未配置');
    return await this._mp.testConnection();
  }

  getKnowledgeBase() { return this._kb; }

  setContext(context) {
    this._context = context;
  }

  getContext() {
    return this._context || {};
  }

  /**
   * Interpret a chart — one-shot RAG + prompt -> stream.
   * @param {object} chartData - ChartData DTO from AstrologyService
   * @param {object} [options]
   * @yields {{ type: 'token'|'done', data: string|object }}
   */
  async *interpret(chartData, options = {}) {
    this._ensureConfigured();
    const sessionId = options.sessionId || String(Date.now());
    const ac = new AbortController();
    this._abortControllers.set(sessionId, ac);

    try {
      const chartText = toText(chartData);
      const chartType = options.chartType || (chartData.meta && chartData.meta.typeNameZh) || '星盘';
      const stream = await this._chainFactory.buildInterpretStream(chartText, chartType, ac.signal);

      for await (const chunk of stream) {
        if (ac.signal.aborted) break;
        const token = typeof chunk === 'string' ? chunk : (chunk.content || '');
        if (token) yield { type: 'token', data: token };
      }
    } finally {
      this._abortControllers.delete(sessionId);
    }
    yield { type: 'done', data: { sessionId } };
  }

  /**
   * Chat with tool-calling loop.
   * @param {Array} userMessages - [{ role: 'user'|'assistant', content }]
   * @param {object} [context]
   * @yields {{ type: 'token'|'tool-call'|'done', data }}
   */
  async *chat(userMessages, context = {}) {
    this._ensureConfigured();
    const sessionId = context.sessionId || String(Date.now());
    const ac = new AbortController();
    this._abortControllers.set(sessionId, ac);

    try {
      const { model, systemPrompt, tools } = await this._chainFactory.prepareChatModel(
        context.currentChartText || null,
        this._tools,
      );

      const { SystemMessage, HumanMessage, AIMessage, ToolMessage } = await esm.load('@langchain/core/messages');

      const messages = [new SystemMessage(systemPrompt)];
      for (const m of userMessages) {
        if (m.role === 'user') messages.push(new HumanMessage(m.content));
        else if (m.role === 'assistant') messages.push(new AIMessage(m.content));
      }

      // Tool-calling loop (max 5 iterations to prevent infinite loops)
      for (let iter = 0; iter < 5; iter++) {
        if (ac.signal.aborted) break;

        let fullContent = '';
        let toolCalls = [];

        const stream = await model.stream(messages, { signal: ac.signal });
        for await (const chunk of stream) {
          if (ac.signal.aborted) break;
          const token = typeof chunk === 'string' ? chunk : (chunk.content || '');
          if (token) {
            fullContent += token;
            yield { type: 'token', data: token };
          }
          // Collect tool calls from chunks
          if (chunk.tool_calls && chunk.tool_calls.length) {
            toolCalls.push(...chunk.tool_calls);
          }
        }

        // If no tool calls, we're done
        if (!toolCalls.length) break;

        // Execute tool calls
        messages.push(new AIMessage({ content: fullContent, tool_calls: toolCalls }));

        for (const tc of toolCalls) {
          if (ac.signal.aborted) break;
          yield { type: 'tool-call', data: { tool: tc.name, status: 'calling' } };

          const tool = tools.find((t) => t.name === tc.name);
          let result = `未知工具: ${tc.name}`;
          if (tool) {
            try {
              result = await tool.invoke(tc.args);
            } catch (e) {
              result = `工具调用失败: ${e.message}`;
            }
          }

          messages.push(new ToolMessage({ content: result, tool_call_id: tc.id }));
          yield { type: 'tool-call', data: { tool: tc.name, status: 'done' } };
        }
        // Loop continues — model will process tool results and generate final response
      }
    } finally {
      this._abortControllers.delete(sessionId);
    }
    yield { type: 'done', data: { sessionId } };
  }

  stop(sessionId) {
    const ac = this._abortControllers.get(sessionId);
    if (ac) {
      ac.abort();
      this._abortControllers.delete(sessionId);
    }
  }

  async close() {
    for (const ac of this._abortControllers.values()) ac.abort();
    this._abortControllers.clear();
  }

  _ensureConfigured() {
    if (!this._configured) throw new Error('AI 服务未配置，请先在设置中配置 API Key');
  }
}

module.exports = AiService;
