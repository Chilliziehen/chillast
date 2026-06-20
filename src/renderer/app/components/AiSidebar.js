import { h, mount } from '../Dom.js';
import { t } from '../I18n.js';
import { notify } from './Toast.js';

import 'deep-chat';

export class AiSidebar {
  constructor({ onNavigate }) {
    this._onNavigate = onNavigate;
    this._configured = false;
    this._context = {};
    this._aiSessionId = null;
    this._build();
  }

  get element() { return this._root; }

  _build() {
    this._statusBanner = h('div', { class: 'ai-status-banner', style: { display: 'none' } });

    this._llmStatusDot = h('span', { class: 'llm-status-dot disconnected' }, '●');
    this._llmStatusText = h('span', { class: 'llm-status-text fs-xs text-muted' }, t('ai.llmDisconnected'));

    // Create deep-chat element
    this._chatEl = document.createElement('deep-chat');
    this._chatEl.className = 'ai-deep-chat';
    this._chatEl.setAttribute('style', 'flex:1;min-height:0;border-radius:0;');
    this._chatEl.setAttribute('textInput', JSON.stringify({
      placeholder: { text: t('ai.inputPlaceholder') },
    }));
    this._chatEl.setAttribute('style', JSON.stringify({
      borderRadius: '0',
      border: 'none',
      backgroundColor: 'var(--bg-panel-solid)',
      colorScheme: 'dark',
    }));
    this._chatEl.setAttribute('avatars', JSON.stringify({ default: { styles: { avatar: { size: '28px' } } } }));
    this._chatEl.setAttribute('messageStyles', JSON.stringify({
      default: {
        shared: {
          inner: {
            styles: {
              color: 'var(--text-primary)',
              background: 'var(--bg-elevated)',
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '13px',
              lineHeight: '1.6',
            },
          },
        },
        user: { bubble: { styles: { background: 'var(--accent-violet-soft)' } } },
        ai: { bubble: { styles: { background: 'var(--bg-elevated)' } } },
      },
    }));
    this._chatEl.setAttribute('submitButtonStyles', JSON.stringify({
      submit: {
        container: {
          default: { backgroundColor: 'var(--accent)', color: '#fff' },
          hover: { backgroundColor: 'var(--accent-strong)' },
        },
      },
    }));
    this._chatEl.setAttribute('historyDisabled', 'true');

    // Set up the handler — intercepts messages and routes through IPC
    this._chatEl.handler = {
      stream: async (body, signals) => {
        this._aiSessionId = String(Date.now());
        const messages = (body.messages || []).map((m) => ({
          role: m.role === 'ai' ? 'assistant' : m.role,
          content: m.text || '',
        }));

        window.mystApi.ai.removeAllListeners();
        window.mystApi.ai.onToken(({ type, data }) => {
          if (type === 'token') signals.onStreamSignal({ text: data });
          else if (type === 'tool-call') signals.onStreamSignal({ text: `\n_⚙ ${data.tool}..._\n` });
        });

        try {
          await window.mystApi.ai.chat(messages, {});
          signals.onStreamEnd();
        } catch (err) {
          signals.onStreamSignal({ text: `\n\n❌ ${err.message}` });
          signals.onStreamEnd();
        }
      },
    };

    // AI Interpret button
    this._interpretBtn = h('button', {
      class: 'btn btn-sm btn-ghost ai-interpret-btn',
      onclick: () => this._onInterpret(),
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
        this._chatEl,
        h('div', { class: 'ai-action-row' }, [this._interpretBtn]),
      ]),
    ]);

    // Register status change listener
    window.mystApi.ai.onStatusChanged((status) => {
      this._applyStatus(status);
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

  _onInterpret() {
    if (!this._context.lastChartData) { notify.error(t('ai.noChart')); return; }
    this._aiSessionId = String(Date.now());

    window.mystApi.ai.removeAllListeners();
    window.mystApi.ai.onToken(({ type, data }) => {
      if (type === 'token') {
        // Push token into deep-chat as a streaming AI response
        this._chatEl.populateStreamResponse({ text: data });
      }
    });
    window.mystApi.ai.onDone(() => {
      this._chatEl.finalizeStreamResponse();
    });
    window.mystApi.ai.onError(({ message }) => {
      this._chatEl.finalizeStreamResponse();
    });

    // Add a user message to show what's being interpreted
    this._chatEl.submitUserMessage({ text: t('ai.interpret') }, false);

    window.mystApi.ai.interpret(this._context.lastChartData, { chartType: this._context.chartType });
  }
}
