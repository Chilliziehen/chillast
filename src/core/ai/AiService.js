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

    // Verify chat model works — don't block on failure, just log
    try {
      await this._mp.testConnection();
    } catch (e) {
      console.error('[AiService] Chat model test failed:', e.message);
      // Don't throw — user may still want to use the service with a different model later
    }

    // KB initialization may fail if embeddings API is unavailable (e.g. DeepSeek doesn't support embeddings)
    // Chat can still work without RAG
    try {
      this._kb = new KnowledgeBase(this._mp);
      if (settings.knowledgeBuiltinPath) {
        await this._kb.initialize(settings.knowledgeBuiltinPath, settings.knowledgeUserPath || null);
      }
    } catch (e) {
      console.error('[AiService] KnowledgeBase init failed, continuing without RAG:', e.message);
      this._kb = null;
    }

    try {
      this._chainFactory = new ChainFactory(this._mp, this._kb);
      this._tools = await createTools(this._astrology, this._chinese, this);
    } catch (e) {
      console.error('[AiService] Tools init failed:', e.message);
      this._tools = [];
    }

    this._configured = true;
  }

  status() {
    return {
      configured: this._configured,
      provider: (this._mp._settings && this._mp._settings.provider) || '',
      model: (this._mp._settings && this._mp._settings.model) || '',
      baseUrl: (this._mp._settings && this._mp._settings.baseUrl) || '',
      temperature: this._mp._settings && this._mp._settings.temperature,
      maxTokens: this._mp._settings && this._mp._settings.maxTokens,
      knowledgeDocCount: this._kb ? this._kb.listDocuments().length : 0,
    };
  }

  async testConnection() {
    if (!this._configured) throw new Error('AI 服务未配置');
    return await this._mp.testConnection();
  }

  /**
   * Test connectivity with given settings WITHOUT persisting.
   * Used by the settings page "test connection" button before saving.
   * @param {object} settings — { provider, model, apiKey, baseUrl, temperature, maxTokens }
   */
  async testWithSettings(settings) {
    const ModelProvider = require('./ModelProvider');
    return await ModelProvider.testWithSettings(settings);
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
        if (!m || !m.content) continue;
        if (m.role === 'user') messages.push(new HumanMessage(m.content));
        // Session store persists AI turns as role 'ai'; LangChain providers use 'assistant'.
        else if (m.role === 'assistant' || m.role === 'ai') messages.push(new AIMessage(m.content));
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

  /**
   * Generate a short conversation title (≤12 Chinese chars) from messages.
   * Uses a single non-streaming LLM call. Returns '' on any failure so the
   * caller can fall back to the first user message.
   * @param {Array} messages - [{ role, content }]
   */
  async summarizeTitle(messages) {
    if (!this._configured) return '';
    const model = this._mp.chatModel();
    if (!model) return '';
    const convo = (messages || [])
      .filter((m) => m && m.content)
      .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
      .join('\n')
      .slice(0, 2000);
    if (!convo) return '';
    try {
      const { SystemMessage, HumanMessage } = await esm.load('@langchain/core/messages');
      const res = await model.invoke([
        new SystemMessage('你是对话标题生成器。根据对话内容用不超过12个汉字概括主题，只输出标题本身，不要任何标点、引号或解释。'),
        new HumanMessage(convo),
      ]);
      let title = typeof res === 'string' ? res : (res && res.content) || '';
      if (Array.isArray(title)) {
        title = title.map((p) => (typeof p === 'string' ? p : p.text || '')).join('');
      }
      return String(title)
        .replace(/[\r\n]+/g, ' ')
        .replace(/^["'「『《\s]+|["'」』》\s]+$/g, '')
        .slice(0, 20)
        .trim();
    } catch (_) {
      return '';
    }
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
