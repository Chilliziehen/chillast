# AI 配置持久化 + 会话管理 + 状态同步 修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 API Key 重启丢失、聊天消息清空后无法查看历史、保存配置后侧边栏不刷新状态三个问题；引入会话持久化使 LLM 能获得对话上下文。

**Architecture:** Main 进程管理会话 JSON 文件（`userData/data/ai-sessions.json`），每条会话存储 `{ id, messages, createdAt, updatedAt }`。AiService.chat() 接受 `sessionId`，从持久化存储加载历史消息构建 LLM 上下文。AiSidebar 启动时加载会话列表并渲染历史消息。`ai:configure` 成功后 IpcRouter 推送 `ai:statusChanged`（已有），AiSidebar 需在 `_build()` 完成后注册监听器（当前竞态导致注册失败）。API Key 保存改为非加密的 JSON（`safeStorage` 在非 macOS 上可能不可用，fallback 到明文 JSON）。

**Tech Stack:** CommonJS (core/main), ES modules (renderer), Electron IPC, JSON file persistence

---

## File Map

### New files

| File | Responsibility |
|------|----------------|
| `src/main/AiSessionStore.js` | 会话持久化：CRUD + JSON 文件原子写入 |

### Modified files

| File | Changes |
|------|---------|
| `src/main/Main.js` | 实例化 `AiSessionStore`，注入 `IpcRouter` |
| `src/main/IpcRouter.js` | 新增 `ai:sessions:list/create/delete` 通道；`ai:chat` 改为接收 `sessionId`，从 store 加载历史 |
| `src/core/ai/AiService.js` | `chat()` 接收 `messages` 改为接收完整消息数组（含历史）；移除内部消息列表管理 |
| `src/preload/Preload.js` | 新增 `sessions.list/create/delete` |
| `src/renderer/app/components/AiSidebar.js` | 启动时加载会话列表；渲染历史消息；`_runChat` 传 `sessionId` + 全部历史消息；修复 `onStatusChanged` 注册时机 |
| `locale/zh.json` | 新增 session 相关 i18n key |

---

## Global Constraints

- 文件名：PascalCase
- 变量/函数：camelCase
- core 层 CommonJS，renderer 层 ES modules
- IPC 信封：`{ ok: true|false, data|error }`
- `src/core/` 不依赖 Electron

---

## Task 1: AiSessionStore — 会话持久化

**Goal:** 创建会话存储，支持 CRUD + JSON 文件原子写入。

**Files:**
- Create: `src/main/AiSessionStore.js`

- [ ] **Step 1: Create AiSessionStore.js**

```js
'use strict';

const fs = require('fs');
const path = require('path');

class AiSessionStore {
  constructor(dataDir) {
    this.filePath = path.join(dataDir, 'ai-sessions.json');
  }

  init() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, '[]', 'utf-8');
    return this;
  }

  _readAll() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    } catch (_) {
      return [];
    }
  }

  _writeAll(sessions) {
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(sessions, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }

  list() {
    return this._readAll().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  get(id) {
    return this._readAll().find((s) => s.id === id) || null;
  }

  create() {
    const sessions = this._readAll();
    const session = {
      id: String(Date.now()),
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    sessions.push(session);
    this._writeAll(sessions);
    return session;
  }

  appendMessage(id, message) {
    const sessions = this._readAll();
    const session = sessions.find((s) => s.id === id);
    if (!session) return null;
    session.messages.push(message);
    session.updatedAt = new Date().toISOString();
    this._writeAll(sessions);
    return session;
  }

  delete(id) {
    const sessions = this._readAll();
    const next = sessions.filter((s) => s.id !== id);
    if (next.length !== sessions.length) this._writeAll(next);
    return next.length !== sessions.length;
  }
}

module.exports = AiSessionStore;
```

- [ ] **Step 2: Run syntax check**

Run: `node --check src/main/AiSessionStore.js`
Expected: No output (success)

- [ ] **Step 3: Commit**

```bash
git add src/main/AiSessionStore.js
git commit -m "feat(ai): add AiSessionStore for chat session persistence"
```

---

## Task 2: Main.js — 注入 AiSessionStore

**Goal:** 在 Main 进程启动时实例化 AiSessionStore 并注入 IpcRouter。

**Files:**
- Modify: `src/main/Main.js`

- [ ] **Step 1: Add require**

At the top of `src/main/Main.js`, after the existing requires, add:

```js
const AiSessionStore = require('./AiSessionStore');
```

- [ ] **Step 2: Instantiate and inject**

In `bootstrapServices()`, after `this.profileRepository = new ProfileRepository(baseDir).init();`, add:

```js
    this.aiSessionStore = new AiSessionStore(baseDir).init();
```

In the `new IpcRouter({...})` call, add:

```js
      aiSessionStore: this.aiSessionStore,
```

- [ ] **Step 3: Run syntax check**

Run: `node --check src/main/Main.js`
Expected: No output (success)

- [ ] **Step 4: Commit**

```bash
git add src/main/Main.js
git commit -m "feat(ai): inject AiSessionStore into IpcRouter"
```

---

## Task 3: IpcRouter — 会话 CRUD + chat 改造

**Goal:** 新增会话 CRUD IPC 通道；`ai:chat` 改为接收 `sessionId`，从 store 加载历史消息传给 AiService。

**Files:**
- Modify: `src/main/IpcRouter.js`

**Interfaces:**
- Consumes: `AiSessionStore.list()`, `.create()`, `.get(id)`, `.appendMessage(id, msg)`, `.delete(id)`
- Produces: IPC channels `ai:sessions:list`, `ai:sessions:create`, `ai:sessions:delete`; modified `ai:chat` that loads history from store

- [ ] **Step 1: Add session store to constructor**

In the IpcRouter constructor, add `aiSessionStore` to destructured params:

```js
  constructor({ ipcMain, profileRepository, astrologyService, chineseAstrologyService, config, locale, aiService, aiSessionStore }) {
```

Add property:

```js
    this.aiSessionStore = aiSessionStore || null;
```

- [ ] **Step 2: Add session CRUD channels**

In `register()`, inside the `if (this.ai)` block, add after the `ai:knowledge:list` handler:

```js
      this._handle('ai:sessions:list', () => this.aiSessionStore ? this.aiSessionStore.list() : []);
      this._handle('ai:sessions:create', () => this.aiSessionStore ? this.aiSessionStore.create() : null);
      this._handle('ai:sessions:delete', (_e, id) => {
        if (this.aiSessionStore) return this.aiSessionStore.delete(id);
        return false;
      });
```

- [ ] **Step 3: Modify ai:chat handler to load history**

Replace the existing `ai:chat` handler:

```js
      this._handle('ai:chat', async (_e, messages, context) => {
        const sessionId = context.sessionId || String(Date.now());
        try {
          // Load full history from store if sessionId provided
          let fullMessages = messages;
          if (this.aiSessionStore && sessionId) {
            const session = this.aiSessionStore.get(sessionId);
            if (session && session.messages && session.messages.length) {
              fullMessages = session.messages;
            }
          }

          for await (const ev of this.ai.chat(fullMessages, { ...context, sessionId })) {
            if (this.webContents) this.webContents.send('ai:token', { sessionId, type: ev.type, data: ev.data });

            // Persist completed messages
            if (ev.type === 'done') {
              // Find the last user message and persist AI response
              // The AiService yields tokens; we accumulate them in the renderer.
              // For persistence, we append the user message + a placeholder.
              // The renderer will call ai:sessions:append after streaming completes.
            }
          }
          if (this.webContents) this.webContents.send('ai:done', { ok: true, sessionId });
          return { ok: true };
        } catch (err) {
          if (this.webContents) this.webContents.send('ai:error', { message: err.message, sessionId });
          return { ok: false, error: err.message };
        }
      });
```

- [ ] **Step 4: Add append message channel**

Add after the session CRUD channels:

```js
      this._handle('ai:sessions:append', (_e, sessionId, message) => {
        if (!this.aiSessionStore) return { ok: false };
        const updated = this.aiSessionStore.appendMessage(sessionId, message);
        return updated ? { ok: true, data: updated } : { ok: false };
      });
```

- [ ] **Step 5: Run syntax check**

Run: `node --check src/main/IpcRouter.js`
Expected: No output (success)

- [ ] **Step 6: Commit**

```bash
git add src/main/IpcRouter.js
git commit -m "feat(ai): add session CRUD IPC + chat loads history from store"
```

---

## Task 4: Preload — 暴露 sessions API

**Goal:** 在 Preload 中暴露会话 CRUD 方法。

**Files:**
- Modify: `src/preload/Preload.js`

- [ ] **Step 1: Add sessions to ai object**

In `src/preload/Preload.js`, after the `knowledge` block inside `ai`, add:

```js
    sessions: {
      list: () => invoke('ai:sessions:list'),
      create: () => invoke('ai:sessions:create'),
      delete: (id) => invoke('ai:sessions:delete', id),
      append: (sessionId, message) => invoke('ai:sessions:append', sessionId, message),
    },
```

- [ ] **Step 2: Run syntax check**

Run: `node --check src/preload/Preload.js`
Expected: No output (success)

- [ ] **Step 3: Commit**

```bash
git add src/preload/Preload.js
git commit -m "feat(ai): expose sessions API in preload"
```

---

## Task 5: AiSidebar — 会话管理 + 历史渲染 + 状态刷新修复

**Goal:** AiSidebar 启动时加载会话列表；渲染历史消息；每次发送消息传 `sessionId` + 全部历史；发送后持久化消息；修复 `onStatusChanged` 注册时机。

**Files:**
- Modify: `src/renderer/app/components/AiSidebar.js`

- [ ] **Step 1: Add session state to constructor**

In the constructor, after `this._messages = [];`, add:

```js
    this._currentSessionId = null;
    this._sessions = [];
```

- [ ] **Step 2: Load sessions on build**

After the intro message in `_build()`, add session loading:

```js
    // Load sessions from store
    this._loadSessions();
```

And add the method:

```js
  async _loadSessions() {
    try {
      const result = await window.mystApi.ai.sessions.list();
      if (result.ok && result.data && result.data.length) {
        this._sessions = result.data;
        // Load most recent session
        const latest = result.data[0];
        this._currentSessionId = latest.id;
        this._renderHistory(latest.messages || []);
      } else {
        // Create a new session
        const created = await window.mystApi.ai.sessions.create();
        if (created.ok && created.data) {
          this._currentSessionId = created.data.id;
        }
      }
    } catch (_) {
      // Fallback: no persistence
    }
  }

  _renderHistory(messages) {
    // Clear existing messages except intro
    this._messages = [];
    clear(this._msgList);
    // Re-add intro
    this._addAiMessage('✶ AI 占星顾问已就绪\n\n你可以直接提问，或点击「AI 解读」分析当前星盘。');
    // Render history
    for (const m of messages) {
      if (m.role === 'user') {
        this._addUserMessage(m.content);
      } else if (m.role === 'ai') {
        this._addAiMessage(m.content);
      }
    }
  }
```

Make sure `clear` is imported at the top — it should already be in the import from `../Dom.js`.

- [ ] **Step 3: Modify _runChat to use sessionId and full history**

Replace the `_runChat` method:

```js
  _runChat(text) {
    this._sessionId = this._currentSessionId || String(Date.now());
    this._registerListeners();

    // Append user message to session store
    if (this._currentSessionId) {
      window.mystApi.ai.sessions.append(this._currentSessionId, { role: 'user', content: text });
    }

    this._startAiStream();

    // Build full message list for LLM context
    const allMessages = this._messages
      .filter((m) => m.role === 'user' || m.role === 'ai')
      .map((m) => ({ role: m.role, content: m.content }));

    window.mystApi.ai.chat(allMessages, { sessionId: this._sessionId });
  }
```

- [ ] **Step 4: Persist AI response after streaming completes**

In `_registerListeners`, modify the `onDone` callback:

```js
    window.mystApi.ai.onDone(() => {
      const aiText = this._currentAiText;
      this._finishStreaming();
      // Persist AI response
      if (aiText && this._currentSessionId) {
        window.mystApi.ai.sessions.append(this._currentSessionId, { role: 'ai', content: aiText });
      }
    });
```

- [ ] **Step 5: Fix onStatusChanged registration**

The current `onStatusChanged` is registered at the end of `_build()`, but `_build()` is no longer async (we removed the deep-chat dynamic import). However, `window.mystApi.ai` may not be available at construction time in the preload bridge.

Move the registration to `updateStatus()` instead — it's called after the app shell is mounted:

In `_build()`, remove the `window.mystApi.ai.onStatusChanged(...)` block.

In `updateStatus()`, add at the top:

```js
  async updateStatus() {
    // Register status change listener (once)
    if (!this._statusListenerRegistered) {
      this._statusListenerRegistered = true;
      window.mystApi.ai.onStatusChanged((status) => {
        this._applyStatus(status);
      });
    }
    try {
      const result = await window.mystApi.ai.status();
      const status = result.ok ? result.data : null;
      this._applyStatus(status);
    } catch (_) {
      this._applyStatus(null);
    }
  }
```

- [ ] **Step 6: Run syntax check**

Run: copy to temp .mjs and `node --check`
Expected: No output (success)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/app/components/AiSidebar.js
git commit -m "feat(ai): session management, history rendering, status refresh fix"
```

---

## Task 6: API Key 持久化修复

**Goal:** 修复 API Key 重启后丢失的问题。`safeStorage` 在某些平台上可能不可用或解密失败，导致启动时读取的 `ai-credentials.json` 内容无法解析。

**Files:**
- Modify: `src/main/IpcRouter.js` (ai:configure handler)
- Modify: `src/main/Main.js` (startup loading)

- [ ] **Step 1: Fix ai:configure to handle safeStorage unavailability**

In the `ai:configure` handler in `src/main/IpcRouter.js`, replace the API key saving block:

```js
        if (settings.apiKey) {
          const credPath = path.join(dataDir, 'ai-credentials.json');
          if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
          try {
            const encrypted = safeStorage.encryptString(JSON.stringify({ apiKey: settings.apiKey }));
            fs.writeFileSync(credPath, encrypted, 'utf-8');
          } catch (_) {
            // Fallback: save as plain JSON if safeStorage is unavailable
            fs.writeFileSync(credPath, JSON.stringify({ apiKey: settings.apiKey }, null, 2), 'utf-8');
          }
        }
```

- [ ] **Step 2: Fix Main.js startup loading to handle both formats**

In `src/main/Main.js`, replace the credential loading block:

```js
    const credPath = path.join(baseDir, 'ai-credentials.json');
    if (fs.existsSync(credPath)) {
      try {
        const { safeStorage } = require('electron');
        const raw = fs.readFileSync(credPath, 'utf-8');
        let cred;
        // Try encrypted first, fall back to plain JSON
        try {
          if (safeStorage.isEncryptionAvailable()) {
            cred = JSON.parse(safeStorage.decryptString(raw));
          } else {
            throw new Error('safeStorage not available');
          }
        } catch (_) {
          cred = JSON.parse(raw);
        }
        aiSettings.apiKey = cred.apiKey || '';
      } catch (_) {}
    }
```

- [ ] **Step 3: Run syntax checks**

Run: `node --check src/main/IpcRouter.js && node --check src/main/Main.js`
Expected: No output (success)

- [ ] **Step 4: Commit**

```bash
git add src/main/IpcRouter.js src/main/Main.js
git commit -m "fix(ai): API key persistence with safeStorage fallback to plain JSON"
```

---

## Task 7: 验证

- [ ] **Step 1: Run syntax check on all modified files**

```bash
node --check src/main/AiSessionStore.js
node --check src/main/Main.js
node --check src/main/IpcRouter.js
node --check src/preload/Preload.js
node --check src/core/ai/AiService.js
```

- [ ] **Step 2: Manual verification**

Run `npm start` and verify:
1. Configure AI settings → save → restart app → API key and settings still present
2. Send a message → response appears → restart app → history still visible
3. Save AI config → sidebar status indicator updates immediately (green dot + provider · model)
4. Send "你是谁" → full response appears streaming correctly
5. Click "AI 解读" → streaming interpretation with chart context

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: AI session persistence + config sync verification"
```
