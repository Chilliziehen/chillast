# AI 占星顾问系统实施计划 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate LangChain.js with LLM support, a RAG knowledge base, and Tool Calling to enable AI-powered chart interpretation, interactive Q&A, and knowledge-grounded astrology analysis within the Myst Electron desktop app.

**Architecture:** A new `src/core/ai/` module provides `AiService` (facade), `ChainFactory` (chain/agent construction), `ModelProvider` (multi-LLM adapter), `KnowledgeBase` (RAG: document loading → splitting → embedding → vector retrieval), and `AstroToolkit` (wrapping existing `AstrologyService` / `ChineseAstrologyService` as LangChain tools). Streaming output uses Electron IPC push (`webContents.send`) rather than request-response. The AI layer is a pure consumer of existing engine services — zero changes to the astrology computation layer.

**Tech Stack:** LangChain.js (`langchain` + `@langchain/core` + provider packages), HNSWLib (local vector store), `pdf-parse` (document loading), `zod` (tool schemas), Electron `safeStorage` (API key encryption). CommonJS core layer with dynamic `import()` bridge for ESM-only LangChain packages.

**Spec:** `docs/superpowers/specs/2026-06-20-ai-langchain-astrology-advisor-design.md`

**Branch:** `feat/ai-base`

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `src/core/ai/AiService.js` | Facade: interpret / chat / configure / status |
| `src/core/ai/ChainFactory.js` | Build LangChain chains and ReAct agent |
| `src/core/ai/ModelProvider.js` | LLM + Embeddings instantiation, multi-provider switching |
| `src/core/ai/KnowledgeBase.js` | RAG: document load → split → embed → vector store → retrieve |
| `src/core/ai/AstroToolkit.js` | Wrap AstrologyService / ChineseAstrologyService as LangChain Tools |
| `src/core/ai/prompts/InterpretPrompt.js` | System prompt template for chart interpretation |
| `src/core/ai/prompts/ChatPrompt.js` | System prompt template for interactive Q&A |
| `src/core/ai/prompts/ChartSerializer.js` | ChartData DTO → LLM-friendly structured text |
| `assets/knowledge/builtin/*.md` | Built-in astrology knowledge base documents (~10 files) |
| `tests/AiService.test.js` | Unit tests for AiService (mocked LLM) |

**Modified files:**

| Path | Change |
|---|---|
| `package.json` | Add langchain + provider packages + hnswlib-node + pdf-parse + zod |
| `config.json` | Add `ai: { provider, model, temperature, maxTokens, enableRag, ragTopK }` |
| `src/core/config/TokenEngine.js` | `resolve()` passes through `ai` config with defaults |
| `src/main/Main.js` | Bootstrap `AiService`, inject API key from safeStorage, register AI IPC handlers, cleanup on quit |
| `src/main/IpcRouter.js` | Add `ai:*` channel handlers (interpret, chat, stop, configure, status, knowledge CRUD) |
| `src/preload/Preload.js` | Expose `mystApi.ai.*` (invoke + push event listeners) |
| `tests/RunAll.js` | Append AI service test block |

---

## Task 1: Install dependencies + ESM bridge + ModelProvider

**Goal:** Get LangChain.js installed, solve the CommonJS/ESM interop (LangChain packages are ESM-only), and implement `ModelProvider` that can instantiate an LLM for at least one provider (OpenAI). No chain/agent/RAG yet — just prove we can call an LLM from the Electron main process.

**Files:**
- Modify: `package.json`
- Create: `src/core/ai/ModelProvider.js`
- Create: `src/core/ai/esm-bridge.js` (dynamic import helper for CommonJS context)
- Create: `tests/AiSmoke.js` (manual standalone test, not wired into RunAll)

- [ ] **Step 1: Add dependencies to `package.json`**

Add to `dependencies`:
```json
"langchain": "^0.3.0",
"@langchain/core": "^0.3.0",
"@langchain/openai": "^0.3.0",
"@langchain/anthropic": "^0.3.0",
"@langchain/ollama": "^0.1.0",
"@langchain/community": "^0.3.0",
"hnswlib-node": "^3.0.0",
"pdf-parse": "^1.1.1",
"zod": "^3.23.0"
```

Run: `npm install`

- [ ] **Step 2: Create ESM bridge utility**

LangChain packages are ESM-only. The project is `"type": "commonjs"`. Create `src/core/ai/esm-bridge.js` — a CommonJS module that uses dynamic `import()` to load ESM packages on demand:

```js
'use strict';

// Cache resolved imports to avoid repeated dynamic import() overhead.
const _cache = new Map();

async function load(pkg) {
  if (_cache.has(pkg)) return _cache.get(pkg);
  const mod = await import(pkg);
  _cache.set(pkg, mod);
  return mod;
}

module.exports = { load };
```

Every AI module that needs LangChain will be `async` and call `await esmBridge.load('@langchain/openai')` rather than `require(...)`.

- [ ] **Step 3: Implement `ModelProvider.js`**

Create `src/core/ai/ModelProvider.js`:

- `configure(settings)` — accepts `{ provider, model, apiKey, baseUrl, temperature, maxTokens }`, dynamically imports the correct LangChain provider package, and instantiates the `ChatModel` + `Embeddings`.
- `chatModel()` — returns the current `BaseChatModel` instance.
- `embeddings()` — returns the current `Embeddings` instance.
- `isConfigured()` — returns boolean.

Provider mapping:
- `openai` → `@langchain/openai` → `ChatOpenAI` + `OpenAIEmbeddings`
- `anthropic` → `@langchain/anthropic` → `ChatAnthropic` (embeddings fall back to OpenAI or local)
- `ollama` → `@langchain/ollama` → `ChatOllama` + `OllamaEmbeddings`
- `deepseek` → `@langchain/openai` with custom `baseURL`

- [ ] **Step 4: Write a standalone smoke test**

Create `tests/AiSmoke.js` — manually runnable script that configures `ModelProvider` with a test API key (from env var `OPENAI_API_KEY`) and sends a simple prompt "Hello". Verifies the LLM responds without error.

```bash
OPENAI_API_KEY=sk-... node tests/AiSmoke.js
```

- [ ] **Step 5: Verify and commit**

Run the smoke test. Expected: LLM responds with a greeting.

```bash
git add src/core/ai/ tests/AiSmoke.js package.json package-lock.json
git commit -m "feat(ai): add LangChain dependencies, ESM bridge, ModelProvider"
```

---

## Task 2: ChartSerializer + InterpretPrompt + ChatPrompt

**Goal:** Build the data-to-text serializer and prompt templates. These are pure, testable modules with no LLM calls — they transform ChartData DTOs into LLM-ready prompts. Unit-testable with the existing test harness.

**Files:**
- Create: `src/core/ai/prompts/ChartSerializer.js`
- Create: `src/core/ai/prompts/InterpretPrompt.js`
- Create: `src/core/ai/prompts/ChatPrompt.js`

- [ ] **Step 1: Implement `ChartSerializer.js`**

Converts a ChartData DTO (the enriched output from `ChartStrategy.build()`) into a structured Chinese-language text block. Must handle:
- Single-ring charts (natal, return, composite, davison)
- Dual-ring charts (transit, progressed, synastry — `rings[0]` + `rings[1]`)
- BaZi data (if present)
- The output format defined in spec §2.6

Key: consume the *enriched* DTO fields (`signNameZh`, `dms`, `glyph`, `nameZh`) that `ChartData.enrichPoint()` already produces — don't re-derive from raw longitude.

- [ ] **Step 2: Implement `InterpretPrompt.js`**

Builds the full prompt for chart interpretation:
- `build(chartText, ragContext, chartType)` → `{ systemMessage, humanMessage }`
- System prompt sets the role, analysis structure, and output format per spec §3.2
- Human message contains the serialized chart data
- RAG context injected between system instructions and chart data

- [ ] **Step 3: Implement `ChatPrompt.js`**

Builds the prompt for interactive Q&A:
- `build(history, currentChartContext)` → system `ChatPromptTemplate`
- System prompt per spec §3.3
- Handles optional `currentChartContext` (serialized chart of whatever the user has open)

- [ ] **Step 4: Add unit tests for ChartSerializer**

Add to `tests/RunAll.js` or a separate test file. Test:
- Serialize a natal chart DTO → verify output contains expected sign names, glyphs, dms values
- Serialize a dual-ring (transit) chart → verify both rings appear
- Edge cases: retrograde markers, empty aspects list

- [ ] **Step 5: Commit**

```bash
git add src/core/ai/prompts/
git commit -m "feat(ai): ChartSerializer, InterpretPrompt, ChatPrompt templates"
```

---

## Task 3: KnowledgeBase (RAG vector store)

**Goal:** Implement the RAG pipeline: load documents (PDF/MD/TXT), split into chunks, embed, store in HNSWLib, and retrieve relevant chunks for a query. Plus the built-in knowledge base documents.

**Files:**
- Create: `src/core/ai/KnowledgeBase.js`
- Create: `assets/knowledge/builtin/*.md` (10 knowledge files)

- [ ] **Step 1: Create built-in knowledge documents**

Write the 10 Markdown files listed in spec §2.3. Each should be 2000-5000 words of curated, authoritative astrology knowledge in Chinese. Sources: standard astrology textbooks, publicly available reference material. Structure each file with clear headings for good chunk boundaries.

Files:
- `planets-in-signs.md` — 行星落座含义
- `planets-in-houses.md` — 行星落宫含义
- `aspects-interpretation.md` — 相位解读
- `house-meanings.md` — 十二宫位含义
- `chart-patterns.md` — 常见格局
- `retrograde-guide.md` — 逆行含义
- `transit-guide.md` — 行运解读指南
- `synastry-guide.md` — 合盘解读指南
- `bazi-basics.md` — 八字基础
- `bazi-interpretation.md` — 八字解读

- [ ] **Step 2: Implement `KnowledgeBase.js`**

API:
- `constructor(modelProvider)` — needs `modelProvider.embeddings()` for vectorization
- `async initialize(builtinPath, userPath)` — load/build vector indices
- `async importDocuments(filePaths)` — user imports new docs
- `async removeDocument(docId)` — remove a user doc
- `listDocuments()` — return metadata list
- `async retrieve(query, k)` — similarity search, return top-k chunks with metadata

Implementation details:
- Use `@langchain/community/vectorstores/hnswlib` for HNSWLib integration
- Use `RecursiveCharacterTextSplitter` with `chunkSize: 1000, chunkOverlap: 200`
- For PDF: use `pdf-parse` via LangChain's `PDFLoader`
- For Markdown/TXT: use `TextLoader`
- Persist index to `userData/knowledge/index/` so re-embedding isn't needed on every startup
- Built-in docs are indexed on first run, then cached
- User docs are indexed on import, persisted immediately

- [ ] **Step 3: Test KnowledgeBase**

Write a test that:
1. Initializes KnowledgeBase with the built-in docs (requires embeddings — use a mock or a cheap model)
2. Queries "太阳在白羊座" → verify returned chunks contain relevant planet-in-sign content
3. Verify document list returns the built-in files

- [ ] **Step 4: Commit**

```bash
git add src/core/ai/KnowledgeBase.js assets/knowledge/
git commit -m "feat(ai): KnowledgeBase RAG pipeline with built-in knowledge docs"
```

---

## Task 4: AstroToolkit (LangChain Tool wrappers)

**Goal:** Wrap the existing `AstrologyService` and `ChineseAstrologyService` as LangChain `DynamicStructuredTool` instances so the LLM agent can call them during conversation.

**Files:**
- Create: `src/core/ai/AstroToolkit.js`

- [ ] **Step 1: Implement `AstroToolkit.js`**

Factory function `createTools(astrologyService, chineseAstrologyService, chartSerializer)` that returns an array of LangChain tools:

1. `compute_natal_chart` — compute a natal chart from birth data
2. `compute_transit` — compute a transit chart (natal + target date)
3. `compute_synastry` — compute a synastry chart between two people
4. `compute_solar_return` — compute a solar return chart for a given year
5. `compute_bazi` — compute Chinese BaZi (Four Pillars)

Each tool:
- Has a `zod` schema for input validation
- Calls the corresponding service method
- Returns `ChartSerializer.toText(result)` as the tool output
- Handles errors gracefully (returns error message string, doesn't throw)

- [ ] **Step 2: Test tools with mock services**

Write tests that verify:
- Each tool accepts valid input and returns a non-empty string
- Invalid input returns an error message
- Tool descriptions are in Chinese and accurately describe capabilities

- [ ] **Step 3: Commit**

```bash
git add src/core/ai/AstroToolkit.js
git commit -m "feat(ai): AstroToolkit wraps engine services as LangChain tools"
```

---

## Task 5: ChainFactory + AiService facade

**Goal:** Wire everything together: build the interpret chain and chat agent, implement the `AiService` facade with streaming support and abort capability.

**Files:**
- Create: `src/core/ai/ChainFactory.js`
- Create: `src/core/ai/AiService.js`

- [ ] **Step 1: Implement `ChainFactory.js`**

Two factory methods:

1. `buildInterpretChain(model, retriever)` — returns a `RunnableSequence`:
   - Input: `{ chartText, chartType }`
   - RAG retrieval on `chartText`
   - `InterpretPrompt.build()` assembles the full prompt
   - `model.stream()` produces the answer

2. `buildChatAgent(model, retriever, tools)` — returns an `AgentExecutor`:
   - Input: `{ messages, currentChartContext? }`
   - Uses `createReactAgent()` or `createToolCallingAgent()` (depending on model capabilities)
   - Binds `AstroToolkit` tools + a RAG retriever tool
   - `BufferWindowMemory` with k=20 for conversation history
   - Streaming via `agentExecutor.streamEvents()`

- [ ] **Step 2: Implement `AiService.js`**

Facade API:
- `constructor(astrologyService, chineseAstrologyService)` — stores service refs
- `async configure(settings)` — sets up ModelProvider, KnowledgeBase, rebuilds chains
- `status()` — returns `{ configured, provider, model, knowledgeDocCount }`
- `async *interpret(chartData, options)` — async generator yielding `{ type, data }` events:
  - `{ type: 'token', data: '根' }`
  - `{ type: 'done', data: { usage } }`
- `async *chat(messages, context)` — async generator yielding events:
  - `{ type: 'token', data: '...' }`
  - `{ type: 'tool-call', data: { tool, status, result? } }`
  - `{ type: 'done', data: { usage } }`
- `stop(sessionId)` — aborts the running generation via `AbortController`

Key: `AiService` uses async generators (`async function*`) to yield streaming events. The IPC layer (Task 6) converts these to push messages.

- [ ] **Step 3: Integration test with mocked LLM**

Create `tests/AiService.test.js`:
- Use `@langchain/core/utils/testing` `FakeListChatModel` to mock LLM responses
- Test interpret flow: pass a ChartData DTO → verify events are yielded in order (token → done)
- Test chat flow: pass a message → verify tool-call events when LLM decides to use a tool
- Test configure: verify status changes after configure
- Test stop: verify AbortError is raised

- [ ] **Step 4: Commit**

```bash
git add src/core/ai/ChainFactory.js src/core/ai/AiService.js tests/AiService.test.js
git commit -m "feat(ai): ChainFactory, AiService facade with streaming interpret + chat"
```

---

## Task 6: IPC wiring + Preload + Main integration

**Goal:** Wire `AiService` into the Electron app: IPC channels, preload bridge, Main bootstrap, API key secure storage. End-to-end an AI interpretation works from the renderer.

**Files:**
- Modify: `src/main/Main.js`
- Modify: `src/main/IpcRouter.js`
- Modify: `src/preload/Preload.js`
- Modify: `config.json`
- Modify: `src/core/config/TokenEngine.js`

- [ ] **Step 1: Add AI config to `config.json` + `TokenEngine.js`**

In `config.json`, add:
```json
"ai": {
  "provider": "openai",
  "model": "gpt-4o",
  "temperature": 0.7,
  "maxTokens": 4096,
  "enableRag": true,
  "ragTopK": 6
}
```

In `TokenEngine.resolve()`, add:
```js
ai: raw.ai || { provider: 'openai', model: 'gpt-4o', temperature: 0.7, maxTokens: 4096, enableRag: true, ragTopK: 6 },
```

- [ ] **Step 2: Bootstrap AiService in `Main.js`**

Add to `bootstrapServices()`:
- Instantiate `AiService(astrologyService, chineseAstrologyService)`
- Load encrypted API key from `safeStorage` → `AiService.configure({ ...config.ai, apiKey })`
- Initialize KnowledgeBase with built-in + user paths
- Add `AiService.close()` to `app.on('quit')`

Inject `aiService` into `IpcRouter`.

- [ ] **Step 3: Add AI IPC handlers to `IpcRouter.js`**

New handlers:
- `ai:interpret` — call `aiService.interpret()`, iterate async generator, `webContents.send('ai:token')` for each token, `webContents.send('ai:done')` at end
- `ai:chat` — same pattern with `aiService.chat()`
- `ai:stop` — call `aiService.stop(sessionId)`
- `ai:configure` — update settings, re-encrypt API key
- `ai:status` — return service status
- `ai:knowledge:list/import/remove` — knowledge base CRUD

The streaming handlers need a reference to `mainWindow.webContents` for push. Inject `webContents` into `IpcRouter` from `Main.js`.

- [ ] **Step 4: Extend Preload bridge**

Add `mystApi.ai.*` per spec §4.3:
- Invoke methods: `interpret`, `chat`, `stop`, `configure`, `status`
- Push event listeners: `onToken`, `onToolCall`, `onDone`, `onError`, `removeAllListeners`
- Knowledge CRUD: `knowledge.list`, `knowledge.import`, `knowledge.remove`

- [ ] **Step 5: End-to-end test**

From the Electron dev console:
```js
await mystApi.ai.status()
// → { configured: true, provider: 'openai', model: 'gpt-4o', knowledgeDocCount: 10 }

mystApi.ai.onToken(d => console.log(d.token))
mystApi.ai.onDone(d => console.log('DONE', d))
await mystApi.ai.interpret(chartData, { chartType: 'natal' })
// → tokens stream in console
```

- [ ] **Step 6: Commit**

```bash
git add src/main/ src/preload/ config.json src/core/config/TokenEngine.js
git commit -m "feat(ai): IPC wiring, preload bridge, Main bootstrap for AI service"
```

---

## Task 7: ChatPanelView (renderer UI)

**Goal:** Build the AI chat panel in the renderer — the conversation UI with streaming text display, input field, "AI Interpret" button, and tool-call indicators. Follows the existing Dom.js / no-framework pattern.

**Files:**
- Create: `src/renderer/app/components/ChatPanel.js`
- Create: `src/renderer/app/components/ChatMessage.js`
- Create: `src/renderer/app/components/MarkdownRenderer.js`
- Modify: `src/renderer/app/views/ChartWorkbenchView.js` (add chat panel slot)
- Modify: `src/renderer/app/App.js` (wire up)

- [ ] **Step 1: Implement `ChatMessage.js`**

A component that renders a single chat message (user or AI):
- User messages: plain text, right-aligned
- AI messages: left-aligned, supports streaming (append tokens), markdown rendering
- Tool-call indicator: "正在计算行运盘..." with spinner
- Source citations: collapsible "知识来源" section

- [ ] **Step 2: Implement `MarkdownRenderer.js`**

Lightweight Markdown → DOM converter (no external dependency):
- Headers, bold, italic, lists, code blocks
- Occupies: heading levels, bullet/numbered lists, inline code, bold/italic
- Does NOT need: tables, images, links (keep it minimal)

- [ ] **Step 3: Implement `ChatPanel.js`**

The main chat panel component:
- Message list with scroll (auto-scroll on new tokens)
- Input field with Enter-to-send
- "AI 解读" button (triggers `interpret` with current chart data)
- "停止" button (visible during generation)
- Empty state: "选择一个档案并计算星盘后，可以在这里获取 AI 解读"
- Wire up `mystApi.ai.onToken` / `onDone` / `onError` listeners

- [ ] **Step 4: Integrate into `ChartWorkbenchView.js`**

Add the chat panel as a collapsible right sidebar in the chart workbench layout. Toggle with a button. Default: collapsed.

- [ ] **Step 5: Visual test**

`npm start`, open a chart, expand the AI panel:
- Type a message → verify it appears in the chat
- Click "AI 解读" → verify streaming tokens appear with typing effect
- Click "停止" mid-stream → verify generation stops

- [ ] **Step 6: Commit**

```bash
git add src/renderer/app/components/ChatPanel.js src/renderer/app/components/ChatMessage.js src/renderer/app/components/MarkdownRenderer.js src/renderer/app/views/ChartWorkbenchView.js src/renderer/app/App.js
git commit -m "feat(ai): ChatPanelView with streaming display, input, and interpret button"
```

---

## Task 8: AI Settings panel + API key management

**Goal:** Add an AI settings section in the UI where users can configure the LLM provider, enter API keys (securely stored), manage the knowledge base, and adjust generation parameters.

**Files:**
- Create: `src/renderer/app/components/AiSettings.js`
- Modify: renderer settings view (wherever settings are rendered)
- Modify: `src/main/Main.js` (safeStorage encrypt/decrypt for API keys)

- [ ] **Step 1: Implement `AiSettings.js`**

Settings panel with:
- Provider dropdown: OpenAI / Claude / Ollama / DeepSeek
- Model dropdown (filtered by provider)
- API Key field (password type, shows "已配置 ✓" when saved)
- Ollama base URL field (shown only when provider = ollama)
- Temperature slider (0.0 – 1.0)
- Max tokens slider
- RAG toggle (enable/disable knowledge retrieval)
- Knowledge base section: list of imported docs + import button + delete buttons

- [ ] **Step 2: Implement safeStorage encryption in Main.js**

Add helpers in Main:
- `saveApiKey(provider, key)` — encrypt with `safeStorage.encryptString()`, write to `userData/ai-credentials.json`
- `loadApiKey(provider)` — read + `safeStorage.decryptString()`
- Wire through IPC: `ai:configure` handler reads the key, encrypts, saves

- [ ] **Step 3: Knowledge import UI**

Wire the "导入知识" button to Electron's `dialog.showOpenDialog()` (file picker for PDF/MD/TXT). Selected files are sent via `ai:knowledge:import` IPC, KnowledgeBase processes them, and the document list refreshes.

- [ ] **Step 4: Visual test**

`npm start` → open settings → AI tab:
- Select provider, enter API key, save → verify "已配置 ✓"
- Change provider → verify model dropdown updates
- Import a test PDF → verify it appears in document list
- Delete a document → verify it disappears

- [ ] **Step 5: Commit**

```bash
git add src/renderer/app/components/AiSettings.js src/main/Main.js
git commit -m "feat(ai): AI settings panel with secure API key storage and knowledge management"
```

---

## Task 9: Full integration test + polish

**Goal:** End-to-end verification of the complete AI flow: chart computation → AI interpretation → interactive Q&A with tool calling → knowledge retrieval. Fix edge cases and polish.

- [ ] **Step 1: End-to-end interpret test**

1. `npm start`
2. Create/select a profile
3. Compute a natal chart
4. Click "AI 解读"
5. Verify: streaming text appears, contains relevant interpretation referencing the actual chart data (correct planet positions), cites knowledge sources

- [ ] **Step 2: End-to-end chat test**

1. With a chart open, type "我的金星在什么星座？落在第几宫？"
2. Verify: AI responds with the correct Venus position from the chart
3. Type "帮我看看 2025 年的土星行运"
4. Verify: AI calls `compute_transit` tool (tool-call indicator appears), then provides transit analysis

- [ ] **Step 3: Ollama local model test**

1. Start Ollama locally with a model (e.g., `qwen2.5:7b`)
2. Configure provider = ollama in settings
3. Verify: interpretation works without internet, no API key needed

- [ ] **Step 4: Edge cases**

- No API key configured → clear error message in chat
- Network error mid-stream → graceful error display
- Very long chart (20+ aspects) → serializer handles without truncation
- Stop button during tool call → clean abort
- Switch profiles while AI is generating → abort and reset

- [ ] **Step 5: Run full test suite**

```bash
npm test
npm run smoke
```

All tests green including new AI tests.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(ai): end-to-end integration, edge case handling, polish"
```

---

## Verification Criteria (when is this done?)

1. **Interpret flow**: User clicks "AI 解读" on any computed chart → streaming analysis appears within 3 seconds (first token), completes with structured, accurate interpretation referencing the actual chart data.
2. **Chat flow**: User asks a follow-up question → AI responds contextually, calling computation tools when needed (e.g., for transit analysis), citing knowledge base sources.
3. **Multi-provider**: At least OpenAI and Ollama work end-to-end.
4. **Knowledge base**: Built-in knowledge is indexed on first run; user can import a PDF and see its content referenced in AI responses.
5. **Security**: API key never appears in config.json, renderer console, or IPC logs.
6. **Test suite**: `npm test` passes including AI-specific tests (with mocked LLM).
7. **No regression**: All existing 60 tests still pass; `npm run smoke` green.
