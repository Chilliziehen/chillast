import { h, mount, clear } from '../Dom.js';
import { t } from '../I18n.js';
import { notify } from '../components/Toast.js';

const PROVIDER_LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot 月之暗面',
  zhipuai: 'ZhipuAI 智谱',
  tongyi: 'Tongyi 通义千问',
  ollama: 'Ollama (本地)',
  openai_compat: 'OpenAI 兼容端点',
};

const DEFAULT_MODELS = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6',
  deepseek: 'deepseek-chat',
  moonshot: 'moonshot-v1-8k',
  zhipuai: 'glm-4',
  tongyi: 'qwen-max',
  ollama: 'qwen2.5:7b',
  openai_compat: '',
};

const NO_KEY_PROVIDERS = new Set(['ollama']);

export class SettingsView {
  constructor(context) {
    this.ctx = context;
  }

  get title() {
    return { h1: t('settings.title'), sub: t('settings.sub') };
  }

  render(container) {
    this.container = container;
    this._draw();
  }

  async _draw() {
    const status = await this._fetchStatus();
    const knowledgeDocs = await this._fetchKnowledge();
    const sessions = await this._fetchSessions();

    this.providerSelect = h('select', {
      class: 'select',
      onchange: (e) => this._onProviderChange(e.target.value),
    }, Object.entries(PROVIDER_LABELS).map(([value, label]) =>
      h('option', { value, selected: value === (status && status.provider) }, label)
    ));

    this.modelInput = h('input', {
      class: 'input',
      type: 'text',
      value: (status && status.model) || 'gpt-4o',
      placeholder: 'gpt-4o',
    });

    this.apiKeyInput = h('input', {
      class: 'input',
      type: 'password',
      placeholder: t('settings.apiKeyPlaceholder'),
    });

    this.apiKeyStatus = h('span', {}, '');

    this.baseUrlInput = h('input', {
      class: 'input',
      type: 'text',
      value: (status && status.baseUrl) || '',
      placeholder: t('settings.baseUrlPlaceholder'),
    });

    const savedTemp = (status && typeof status.temperature === 'number') ? String(status.temperature) : '0.7';
    const savedMaxTokens = (status && typeof status.maxTokens === 'number') ? String(status.maxTokens) : '4096';

    this.tempInput = h('input', {
      class: 'input',
      type: 'range', min: '0', max: '1', step: '0.1', value: savedTemp,
      oninput: (e) => { this.tempValue.textContent = e.target.value; },
    });
    this.tempValue = h('span', { class: 'range-value' }, savedTemp);

    this.maxTokensInput = h('input', {
      class: 'input',
      type: 'range', min: '512', max: '8192', step: '512', value: savedMaxTokens,
      oninput: (e) => { this.maxTokensValue.textContent = e.target.value; },
    });
    this.maxTokensValue = h('span', { class: 'range-value' }, savedMaxTokens);

    this.testBtn = h('button', {
      class: 'btn btn-sm btn-ghost',
      onclick: () => this._onTestConnection(),
    }, t('settings.testConnection'));

    this.testResult = h('span', { class: 'test-result' }, '');

    this.saveBtn = h('button', {
      class: 'btn btn-primary',
      onclick: () => this._onSave(),
    }, t('settings.save'));

    this._updateApiKeyStatus(status && status.configured);

    const aiConfigSection = h('div', { class: 'settings-section' }, [
      h('h3', {}, t('settings.aiConfig')),
      h('div', { class: 'settings-row' }, [
        h('label', {}, t('settings.provider')),
        this.providerSelect,
      ]),
      h('div', { class: 'settings-row' }, [
        h('label', {}, t('settings.model')),
        this.modelInput,
      ]),
      h('div', { class: 'settings-row' }, [
        h('label', {}, t('settings.apiKey')),
        this.apiKeyInput,
        this.apiKeyStatus,
      ]),
      h('div', { class: 'settings-row' }, [
        h('label', {}, t('settings.baseUrl')),
        this.baseUrlInput,
      ]),
      h('div', { class: 'settings-row' }, [
        h('label', {}, t('settings.temperature')),
        this.tempInput,
        this.tempValue,
      ]),
      h('div', { class: 'settings-row' }, [
        h('label', {}, t('settings.maxTokens')),
        this.maxTokensInput,
        this.maxTokensValue,
      ]),
      h('div', { class: 'settings-row' }, [
        h('label', {}, ''),
        this.testBtn,
        this.testResult,
      ]),
      this.saveBtn,
    ]);

    const knowledgeSection = this._buildKnowledgeSection(knowledgeDocs);

    const sessionsSection = this._buildSessionsSection(sessions);

    const statusSection = this._buildStatusSection(status, knowledgeDocs);

    mount(this.container, h('div', { class: 'settings-container' }, [
      aiConfigSection,
      knowledgeSection,
      sessionsSection,
      statusSection,
    ]));
  }

  _buildSessionsSection(sessions) {
    const rows = sessions.map((s) => {
      const title = s.title || this._firstUserText(s) || t('settings.sessionUntitled');
      const meta = t('settings.sessionMeta', {
        count: (s.messages || []).length,
        date: this._formatDate(s.updatedAt || s.createdAt),
      });
      return h('div', { class: 'knowledge-list-item' }, [
        h('span', {}, [
          h('span', { class: 'doc-name' }, title),
          h('span', { class: 'doc-source' }, meta),
        ]),
        h('span', { class: 'session-actions' }, [
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => this._onRegenTitle(s) }, t('settings.sessionRegenTitle')),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => this._onRenameSession(s) }, t('settings.sessionRename')),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => this._onDeleteSession(s) }, t('settings.removeDoc')),
        ]),
      ]);
    });

    return h('div', { class: 'settings-section' }, [
      h('h3', {}, t('settings.sessions')),
      h('div', { class: 'fs-sm text-muted mb-2' }, t('settings.sessionsHint', { count: sessions.length })),
      h('div', { class: 'knowledge-list' }, rows.length
        ? rows
        : [h('div', { class: 'fs-sm text-muted' }, t('settings.sessionsEmpty'))]),
    ]);
  }

  _buildKnowledgeSection(docs) {
    const builtin = docs.filter((d) => d.source === 'builtin');
    const user = docs.filter((d) => d.source === 'user');

    const fileInput = h('input', {
      type: 'file',
      accept: '.md,.txt,.pdf',
      multiple: true,
      style: { display: 'none' },
      onchange: (e) => this._onImport(e.target.files),
    });

    const importBtn = h('button', {
      class: 'btn btn-sm btn-ghost',
      onclick: () => fileInput.click(),
    }, t('settings.importDocs'));

    const builtinItems = builtin.map((d) =>
      h('div', { class: 'knowledge-list-item' }, [
        h('span', {}, [
          h('span', { class: 'doc-name' }, d.name),
          h('span', { class: 'doc-source' }, 'builtin'),
        ]),
      ])
    );

    const userItems = user.map((d) =>
      h('div', { class: 'knowledge-list-item' }, [
        h('span', {}, [
          h('span', { class: 'doc-name' }, d.name),
          h('span', { class: 'doc-source' }, 'user'),
        ]),
        h('button', {
          class: 'btn btn-sm btn-ghost',
          onclick: () => this._onRemoveDoc(d),
        }, t('settings.removeDoc')),
      ])
    );

    return h('div', { class: 'settings-section' }, [
      h('h3', {}, t('settings.knowledge')),
      h('div', { class: 'fs-sm text-muted mb-2' }, t('settings.builtinDocs', { count: builtin.length })),
      h('div', { class: 'knowledge-list' }, builtinItems),
      h('div', { class: 'fs-sm text-muted mt-3 mb-2' }, t('settings.userDocs', { count: user.length })),
      h('div', { class: 'knowledge-list' }, userItems),
      h('div', { class: 'mt-2' }, [fileInput, importBtn]),
    ]);
  }

  _buildStatusSection(status, docs) {
    return h('div', { class: 'settings-section' }, [
      h('h3', {}, t('settings.status')),
      h('div', { class: 'settings-status-row' }, [
        h('span', { class: 'label' }, t('settings.serviceStatus')),
        h('span', { class: 'value' }, status && status.configured
          ? h('span', { class: 'api-key-configured' }, t('settings.configured'))
          : h('span', { class: 'api-key-not-set' }, t('settings.notConfigured'))),
      ]),
      h('div', { class: 'settings-status-row' }, [
        h('span', { class: 'label' }, t('settings.providerLabel')),
        h('span', { class: 'value' }, (status && status.provider) || '—'),
      ]),
      h('div', { class: 'settings-status-row' }, [
        h('span', { class: 'label' }, t('settings.modelLabel')),
        h('span', { class: 'value' }, (status && status.model) || '—'),
      ]),
      h('div', { class: 'settings-status-row' }, [
        h('span', { class: 'label' }, t('settings.knowledge')),
        h('span', { class: 'value' }, t('settings.knowledgeCount', { count: docs.length })),
      ]),
    ]);
  }

  _updateApiKeyStatus(configured) {
    mount(this.apiKeyStatus, h('span', {},
      configured
        ? h('span', { class: 'api-key-configured' }, t('settings.apiKeyConfigured'))
        : h('span', { class: 'api-key-not-set' }, t('settings.apiKeyNotSet'))
    ));
  }

  _onProviderChange(provider) {
    if (DEFAULT_MODELS[provider]) {
      this.modelInput.value = DEFAULT_MODELS[provider];
    }
    // Show/hide API key field based on provider
    const needsKey = !NO_KEY_PROVIDERS.has(provider);
    this.apiKeyInput.parentElement.style.display = needsKey ? '' : 'none';
  }

  async _onSave() {
    this.saveBtn.textContent = t('settings.saving');
    this.saveBtn.disabled = true;
    try {
      const settings = {
        provider: this.providerSelect.value,
        model: this.modelInput.value,
        temperature: parseFloat(this.tempInput.value),
        maxTokens: parseInt(this.maxTokensInput.value, 10),
        baseUrl: this.baseUrlInput.value || undefined,
      };
      if (this.apiKeyInput.value) {
        settings.apiKey = this.apiKeyInput.value;
      }
      const result = await window.mystApi.ai.configure(settings);
      if (result.ok) {
        notify.success(t('settings.saved'));
        this.apiKeyInput.value = '';
        await this._refresh();
      } else {
        notify.error(t('settings.saveFailed', { message: result.error }));
      }
    } catch (err) {
      notify.error(t('settings.saveFailed', { message: err.message }));
    }
    this.saveBtn.textContent = t('settings.save');
    this.saveBtn.disabled = false;
  }

  async _onTestConnection() {
    this.testBtn.textContent = t('settings.testing');
    this.testBtn.disabled = true;
    mount(this.testResult, h('span', { class: 'test-result testing' }, '…'));
    try {
      const settings = {
        provider: this.providerSelect.value,
        model: this.modelInput.value,
        temperature: parseFloat(this.tempInput.value),
        maxTokens: parseInt(this.maxTokensInput.value, 10),
        baseUrl: this.baseUrlInput.value || undefined,
      };
      if (this.apiKeyInput.value) {
        settings.apiKey = this.apiKeyInput.value;
      }
      const result = await window.mystApi.ai.testWithSettings(settings);
      if (result.ok) {
        notify.success(t('settings.testSuccess'));
        mount(this.testResult, h('span', { class: 'test-result success' }, t('settings.testSuccess')));
      } else {
        notify.error(t('settings.testFailed', { message: result.error }));
        mount(this.testResult, h('span', { class: 'test-result failed' }, result.error));
      }
    } catch (err) {
      notify.error(t('settings.testFailed', { message: err.message }));
      mount(this.testResult, h('span', { class: 'test-result failed' }, err.message));
    }
    this.testBtn.textContent = t('settings.testConnection');
    this.testBtn.disabled = false;
  }

  async _onImport(fileList) {
    if (!fileList || !fileList.length) return;
    try {
      const paths = Array.from(fileList).map((f) => f.path);
      const result = await window.mystApi.ai.knowledge.import(paths);
      if (result.ok) {
        notify.success(t('settings.imported', { count: result.data.count }));
        await this._refresh();
      } else {
        notify.error(t('settings.importFailed', { message: result.error }));
      }
    } catch (err) {
      notify.error(t('settings.importFailed', { message: err.message }));
    }
  }

  async _onRemoveDoc(doc) {
    if (!confirm(t('settings.removeConfirm', { name: doc.name }))) return;
    try {
      const result = await window.mystApi.ai.knowledge.remove(doc.id);
      if (result.ok) {
        notify.success(t('settings.removed'));
        await this._refresh();
      }
    } catch (err) {
      notify.error(err.message);
    }
  }

  _firstUserText(s) {
    const u = (s.messages || []).find((m) => m.role === 'user');
    return u && u.content ? u.content.slice(0, 24) : '';
  }

  _formatDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch (_) { return ''; }
  }

  async _onRenameSession(s) {
    const current = s.title || this._firstUserText(s) || '';
    const next = prompt(t('settings.sessionRenamePrompt'), current);
    if (next == null) return;
    const title = next.trim();
    if (!title) return;
    try {
      await window.mystApi.ai.sessions.rename(s.id, title);
      notify.success(t('settings.sessionRenamed'));
      await this._refresh();
    } catch (err) { notify.error(err.message); }
  }

  async _onRegenTitle(s) {
    try {
      const result = await window.mystApi.ai.sessions.generateTitle(s.id);
      const title = result.ok && result.data ? result.data.title : '';
      if (title) {
        notify.success(t('settings.sessionTitleGenerated', { title }));
      } else {
        notify.error(t('settings.sessionTitleFailed'));
      }
      await this._refresh();
    } catch (err) { notify.error(err.message); }
  }

  async _onDeleteSession(s) {
    if (!confirm(t('ai.deleteSessionConfirm'))) return;
    try {
      await window.mystApi.ai.sessions.delete(s.id);
      notify.success(t('ai.sessionDeleted'));
      await this._refresh();
    } catch (err) { notify.error(err.message); }
  }

  async _fetchSessions() {
    try {
      const result = await window.mystApi.ai.sessions.list();
      return result.ok ? (result.data || []) : [];
    } catch (_) { return []; }
  }

  async _fetchStatus() {
    try {
      const result = await window.mystApi.ai.status();
      return result.ok ? result.data : null;
    } catch (_) { return null; }
  }

  async _fetchKnowledge() {
    try {
      const result = await window.mystApi.ai.knowledge.list();
      return result.ok ? (result.data || []) : [];
    } catch (_) { return []; }
  }

  async _refresh() {
    clear(this.container);
    await this._draw();
  }
}
