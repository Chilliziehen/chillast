import { h, mount } from '../Dom.js';
import { ChatPanel } from './ChatPanel.js';
import { t } from '../I18n.js';

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

    this.chatPanel = new ChatPanel({
      onInterpret: () => this._onInterpret(),
      onSend: (text) => this._onSend(text),
      onStop: () => this._onStop(),
    });

    this._root = h('aside', { class: 'ai-sidebar' }, [
      h('div', { class: 'ai-sidebar-header' }, [
        h('span', { class: 'fs-md fw-semibold' }, t('ai.title')),
      ]),
      this._statusBanner,
      h('div', { class: 'ai-sidebar-body' }, [this.chatPanel.element]),
    ]);
  }

  async updateStatus() {
    try {
      const result = await window.mystApi.ai.status();
      const status = result.ok ? result.data : null;
      this._configured = status && status.configured;
      if (!this._configured) {
        this._statusBanner.style.display = '';
        mount(this._statusBanner, h('span', {}, [
          h('span', {}, t('ai.notConfigured') + ' '),
          h('a', { onclick: () => this._onNavigate('settings'), style: { cursor: 'pointer' } }, t('ai.goToSettings')),
          h('span', {}, ' ' + t('ai.toConfigure')),
        ]));
      } else {
        this._statusBanner.style.display = 'none';
      }
    } catch (_) {
      this._configured = false;
    }
  }

  setContext(context) {
    this._context = context;
  }

  _onInterpret() {
    if (!this._context.lastChartData) return;
    this._aiSessionId = String(Date.now());
    window.mystApi.ai.removeAllListeners();
    window.mystApi.ai.onToken(({ type, data }) => {
      if (type === 'token') this.chatPanel.appendToken(data);
      else if (type === 'done') this.chatPanel.finishStreaming();
    });
    window.mystApi.ai.onError(({ message }) => {
      this.chatPanel.finishStreaming();
    });
    window.mystApi.ai.interpret(this._context.lastChartData, { chartType: this._context.chartType });
  }

  _onSend(text) {
    this._aiSessionId = String(Date.now());
    window.mystApi.ai.removeAllListeners();
    window.mystApi.ai.onToken(({ type, data }) => {
      if (type === 'token') this.chatPanel.appendToken(data);
      else if (type === 'tool-call') this.chatPanel.showToolCall(data.tool);
      else if (type === 'done') this.chatPanel.finishStreaming();
    });
    window.mystApi.ai.onError(({ message }) => {
      this.chatPanel.finishStreaming();
    });
    window.mystApi.ai.chat([{ role: 'user', content: text }], {});
  }

  _onStop() {
    if (this._aiSessionId) window.mystApi.ai.stop(this._aiSessionId);
  }
}
