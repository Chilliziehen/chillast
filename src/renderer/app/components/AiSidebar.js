import { h, mount, clear } from '../Dom.js';
import { t } from '../I18n.js';
import { notify } from './Toast.js';

/**
 * Lightweight chat UI built on the project's own Dom.js hyperscript.
 * No external dependencies. Streaming is done by directly appending
 * text to the current AI message element.
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

export class AiSidebar {
  constructor({ onNavigate }) {
    this._onNavigate = onNavigate;
    this._configured = false;
    this._context = {};
    this._streaming = false;
    this._messages = [];
    this._currentAiEl = null;
    this._currentAiText = '';
    this._build();
  }

  get element() { return this._root; }

  _build() {
    this._statusBanner = h('div', { class: 'ai-status-banner', style: { display: 'none' } });

    this._llmStatusDot = h('span', { class: 'llm-status-dot disconnected' }, '●');
    this._llmStatusText = h('span', { class: 'llm-status-text fs-xs text-muted' }, t('ai.llmDisconnected'));

    this._msgList = h('div', { class: 'chat-messages' });

    this._input = h('input', {
      class: 'input chat-input',
      placeholder: t('ai.inputPlaceholder'),
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._send(); } },
    });

    this._sendBtn = h('button', {
      class: 'btn btn-sm btn-primary',
      onclick: () => this._send(),
    }, t('ai.send'));

    this._stopBtn = h('button', {
      class: 'btn btn-sm btn-ghost',
      style: { display: 'none' },
      onclick: () => this._stop(),
    }, t('ai.stop'));

    this._interpretBtn = h('button', {
      class: 'btn btn-sm btn-ghost',
      onclick: () => this._triggerInterpret(),
    }, t('ai.interpret'));

    this._root = h('aside', { class: 'ai-sidebar' }, [
      h('div', { class: 'ai-sidebar-header' }, [
        h('span', { class: 'fs-md fw-semibold' }, t('ai.title')),
        h('div', { class: 'llm-status-indicator' }, [
          this._llmStatusDot,
          this._llmStatusText,
        ]),
      ]),
      this._statusBanner,
      h('div', { class: 'ai-sidebar-body' }, [
        this._msgList,
        h('div', { class: 'chat-input-row' }, [
          this._input,
          this._sendBtn,
          this._stopBtn,
          this._interpretBtn,
        ]),
      ]),
    ]);

    // Intro message
    this._addAiMessage('✶ AI 占星顾问已就绪\n\n你可以直接提问，或点击「AI 解读」分析当前星盘。');

    window.mystApi.ai.onStatusChanged((status) => {
      this._applyStatus(status);
    });
  }

  _send() {
    const text = this._input.value.trim();
    if (!text || this._streaming) return;
    this._input.value = '';
    this._addUserMessage(text);
    this._runChat(text);
  }

  _stop() {
    if (this._sessionId) {
      window.mystApi.ai.stop(this._sessionId);
    }
    this._finishStreaming();
  }

  _setStreaming(streaming) {
    this._streaming = streaming;
    this._sendBtn.style.display = streaming ? 'none' : '';
    this._stopBtn.style.display = streaming ? '' : 'none';
    this._input.disabled = streaming;
  }

  _addUserMessage(text) {
    this._messages.push({ role: 'user', content: text });
    const el = h('div', { class: 'chat-msg chat-msg-user' }, [
      h('div', { class: 'chat-msg-body' }, text),
    ]);
    mount(this._msgList, el);
    this._scrollToBottom();
  }

  _addAiMessage(text) {
    this._messages.push({ role: 'ai', content: text });
    const el = h('div', { class: 'chat-msg chat-msg-ai' }, [
      h('div', { class: 'chat-msg-body', html: renderMarkdown(text) }),
    ]);
    mount(this._msgList, el);
    this._scrollToBottom();
    return el;
  }

  _startAiStream() {
    this._currentAiText = '';
    this._currentAiEl = h('div', { class: 'chat-msg chat-msg-ai' }, [
      h('div', { class: 'chat-msg-body', html: '' }),
      h('span', { class: 'chat-cursor' }, '▌'),
    ]);
    mount(this._msgList, this._currentAiEl);
    this._scrollToBottom();
    this._setStreaming(true);
  }

  _appendToken(token) {
    if (!this._currentAiEl) return;
    this._currentAiText += token;
    const body = this._currentAiEl.querySelector('.chat-msg-body');
    if (body) {
      body.innerHTML = renderMarkdown(this._currentAiText);
    }
    this._scrollToBottom();
  }

  _finishStreaming() {
    if (this._currentAiText) {
      this._messages.push({ role: 'ai', content: this._currentAiText });
    }
    this._currentAiText = '';
    this._currentAiEl = null;
    this._setStreaming(false);
  }

  _scrollToBottom() {
    this._msgList.scrollTop = this._msgList.scrollHeight;
  }

  _registerListeners() {
    window.mystApi.ai.removeAllListeners();
    window.mystApi.ai.onToken(({ type, data }) => {
      if (type === 'token') {
        this._appendToken(data);
      } else if (type === 'tool-call') {
        this._appendToken(`\n\n_⚙ ${data.tool}..._\n`);
      }
    });
    window.mystApi.ai.onDone(() => {
      this._finishStreaming();
    });
    window.mystApi.ai.onError(({ message }) => {
      if (this._currentAiEl) {
        this._appendToken(`\n\n❌ ${message}`);
      }
      this._finishStreaming();
    });
  }

  _runChat(text) {
    this._sessionId = String(Date.now());
    this._registerListeners();
    this._startAiStream();
    window.mystApi.ai.chat([{ role: 'user', content: text }], {});
  }

  _triggerInterpret() {
    if (!this._context.lastChartData) { notify.error(t('ai.noChart')); return; }
    if (this._streaming) return;
    this._sessionId = String(Date.now());
    this._registerListeners();
    this._addUserMessage(t('ai.interpret'));
    this._startAiStream();
    window.mystApi.ai.interpret(this._context.lastChartData, {
      chartType: this._context.chartType,
    });
  }

  async updateStatus() {
    try {
      const result = await window.mystApi.ai.status();
      const status = result.ok ? result.data : null;
      this._applyStatus(status);
    } catch (_) {
      this._applyStatus(null);
    }
  }

  _applyStatus(status) {
    this._configured = status && status.configured;
    if (!this._configured) {
      this._statusBanner.style.display = '';
      mount(this._statusBanner, h('span', {}, [
        h('span', {}, t('ai.notConfigured') + ' '),
        h('a', { onclick: () => this._onNavigate('settings'), style: { cursor: 'pointer' } }, t('ai.goToSettings')),
        h('span', {}, ' ' + t('ai.toConfigure')),
      ]));
      this._llmStatusDot.className = 'llm-status-dot disconnected';
      this._llmStatusText.textContent = t('ai.llmDisconnected');
    } else {
      this._statusBanner.style.display = 'none';
      this._llmStatusDot.className = 'llm-status-dot connected';
      this._llmStatusText.textContent = `${status.provider || ''} · ${status.model || ''}`;
    }
  }

  setContext(context) {
    this._context = context;
  }
}
