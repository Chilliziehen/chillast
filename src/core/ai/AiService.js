'use strict';

const ModelProvider = require('./ModelProvider');
const KnowledgeBase = require('./KnowledgeBase');
const ChainFactory = require('./ChainFactory');
const ToolRegistry = require('./tools/ToolRegistry');
const AstroToolProvider = require('./tools/AstroToolProvider');
const ContextToolProvider = require('./tools/ContextToolProvider');
const KnowledgeToolProvider = require('./tools/KnowledgeToolProvider');
const ProfileToolProvider = require('./tools/ProfileToolProvider');
const McpToolProvider = require('./tools/McpToolProvider');
const McpManager = require('./mcp/McpManager');
const { build: buildChatPrompt } = require('./prompts/ChatPrompt');
const { toText } = require('./prompts/ChartSerializer');
const esm = require('./esm-bridge');

class AiService {
  constructor(astrologyService, chineseAstrologyService, profileRepository) {
    this._astrology = astrologyService;
    this._chinese = chineseAstrologyService;
    this._profiles = profileRepository || null;
    this._mp = new ModelProvider();
    this._kb = null;
    this._chainFactory = null;
    this._registry = null;
    this._mcpManager = null;
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

    // KB initialization — skip if enableRag is explicitly false
    if (settings.enableRag === false) {
      this._kb = null;
    } else {
      try {
        this._kb = new KnowledgeBase(this._mp);
        this._kb.setRagTopK(settings.ragTopK || 6);
        if (settings.knowledgeBuiltinPath) {
          await this._kb.initialize(settings.knowledgeBuiltinPath, settings.knowledgeUserPath || null, settings.knowledgeIndexDir || null);
        }
      } catch (e) {
        console.error('[AiService] KnowledgeBase init failed, continuing without RAG:', e.message);
        this._kb = null;
      }
    }

    // Build the pluggable tool registry. Adding a capability later = register a
    // new provider here (or an MCP provider) — the agent loop never changes.
    try {
      if (this._registry) await this._registry.disposeAll();
      this._mcpManager = new McpManager(settings.mcpServers || {});
      this._registry = new ToolRegistry();
      this._registry.register(new AstroToolProvider(this._astrology, this._chinese));
      this._registry.register(new ContextToolProvider(this));
      this._registry.register(new ProfileToolProvider(this._profiles));
      this._registry.register(new KnowledgeToolProvider(this._kb));
      // External MCP servers (off unless explicitly enabled in mcpServers config).
      this._registry.register(new McpToolProvider(this._mcpManager));
      await this._registry.initAll();
      // Apply persisted per-provider enable preferences.
      if (settings.toolProviders) {
        for (const [id, en] of Object.entries(settings.toolProviders)) {
          this._registry.setEnabled(id, !!en);
        }
      }
    } catch (e) {
      console.error('[AiService] Tool registry init failed:', e.message);
      this._registry = new ToolRegistry();
    }

    this._chainFactory = new ChainFactory(this._mp, this._kb);
    this._configured = true;
  }

  /** Expose the tool registry (for the settings UI / introspection). */
  getToolRegistry() { return this._registry; }

  /** Expose the MCP manager (server list / status for the settings UI). */
  getMcpManager() { return this._mcpManager; }

  /**
   * Replace the MCP server set live (from the settings UI) without a full
   * reconfigure: swap the 'mcp' provider, reconnecting only enabled servers.
   */
  async updateMcp(servers) {
    if (!this._registry) return;
    const old = this._registry.unregister('mcp');
    if (old) { try { await old.dispose(); } catch (_) { /* best-effort */ } }
    this._mcpManager = new McpManager(servers || {});
    const provider = new McpToolProvider(this._mcpManager);
    this._registry.register(provider);
    try { await provider.init(); }
    catch (e) { console.error('[AiService] MCP update failed:', e.message); }
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
   * Interactive chat via a LangGraph ReAct agent. The agent owns the
   * tool-calling loop and tool execution; tools come from the ToolRegistry, so
   * the model autonomously chooses among compute / knowledge / (future) MCP
   * tools. We translate the agent's event stream into token / tool-call events.
   * @param {Array} userMessages - [{ role: 'user'|'assistant'|'ai', content }]
   * @param {object} [context]
   * @yields {{ type: 'token'|'tool-call'|'done', data }}
   */
  async *chat(userMessages, context = {}) {
    this._ensureConfigured();
    const sessionId = context.sessionId || String(Date.now());
    const ac = new AbortController();
    this._abortControllers.set(sessionId, ac);

    try {
      const model = this._mp.chatModel();
      const tools = this._registry ? await this._registry.getTools() : [];
      const systemPrompt = buildChatPrompt(context.currentChartText || null);

      const { createReactAgent } = await esm.load('@langchain/langgraph/prebuilt');
      const { HumanMessage, AIMessage } = await esm.load('@langchain/core/messages');

      const agent = createReactAgent({ llm: model, tools, prompt: systemPrompt });

      const lcMessages = [];
      for (const m of userMessages) {
        if (!m || !m.content) continue;
        if (m.role === 'user') lcMessages.push(new HumanMessage(m.content));
        // Session store persists AI turns as role 'ai'; map to assistant message.
        else if (m.role === 'assistant' || m.role === 'ai') lcMessages.push(new AIMessage(m.content));
      }

      const stream = await agent.stream(
        { messages: lcMessages },
        { streamMode: ['messages', 'updates'], signal: ac.signal, recursionLimit: 25 },
      );

      try {
        for await (const chunk of stream) {
          if (ac.signal.aborted) break;
          const [mode, payload] = chunk;

          if (mode === 'messages') {
            // payload = [messageChunk, metadata]; stream only AI text tokens.
            const msg = Array.isArray(payload) ? payload[0] : payload;
            if (msg && this._msgType(msg) === 'ai') {
              const text = this._extractText(msg.content);
              if (text) yield { type: 'token', data: text };
            }
          } else if (mode === 'updates') {
            // payload = { nodeName: { messages: [...] } }; surface tool activity.
            for (const node of Object.keys(payload || {})) {
              const msgs = (payload[node] && payload[node].messages) || [];
              for (const m of msgs) {
                const t = this._msgType(m);
                if (t === 'ai' && m.tool_calls && m.tool_calls.length) {
                  for (const tc of m.tool_calls) {
                    yield { type: 'tool-call', data: { tool: tc.name, status: 'calling' } };
                  }
                } else if (t === 'tool') {
                  yield { type: 'tool-call', data: { tool: m.name, status: 'done' } };
                }
              }
            }
          }
        }
      } catch (e) {
        // A user-initiated stop aborts the stream; treat that as a clean end.
        if (!ac.signal.aborted) throw e;
      }
    } finally {
      this._abortControllers.delete(sessionId);
    }
    yield { type: 'done', data: { sessionId } };
  }

  /** Robustly read a LangChain message's type across versions. */
  _msgType(msg) {
    if (typeof msg.getType === 'function') return msg.getType();
    if (typeof msg._getType === 'function') return msg._getType();
    return '';
  }

  /** Normalize message content (string or content-part array) to text. */
  _extractText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((p) => (typeof p === 'string' ? p : (p && p.text) || '')).join('');
    }
    return '';
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
    if (this._registry) {
      try { await this._registry.disposeAll(); } catch (_) { /* best-effort */ }
    }
  }

  _ensureConfigured() {
    if (!this._configured) throw new Error('AI 服务未配置，请先在设置中配置 API Key');
  }
}

module.exports = AiService;
