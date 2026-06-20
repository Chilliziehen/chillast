import { h, mount, clear } from '../Dom.js';
import { t } from '../I18n.js';
import { notify } from '../components/Toast.js';

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini'] },
  { value: 'anthropic', label: 'Anthropic', models: ['claude-sonnet-4-6', 'claude-haiku-4-5'] },
  { value: 'deepseek', label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { value: 'ollama', label: 'Ollama', models: ['qwen2.5:7b', 'llama3.1:8b'] },
];

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

    this.providerSelect = h('select', {
      class: 'select',
      onchange: (e) => this._onProviderChange(e.target.value),
    }, PROVIDERS.map((p) =>
      h('option', { value: p.value, selected: p.value === (status && status.provider) }, p.label)
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

    this.tempInput = h('input', {
      class: 'input',
      type: 'range', min: '0', max: '1', step: '0.1', value: '0.7',
      oninput: (e) => { this.tempValue.textContent = e.target.value; },
    });
    this.tempValue = h('span', { class: 'range-value' }, '0.7');

    this.maxTokensInput = h('input', {
      class: 'input',
      type: 'range', min: '512', max: '8192', step: '512', value: '4096',
      oninput: (e) => { this.maxTokensValue.textContent = e.target.value; },
    });
    this.maxTokensValue = h('span', { class: 'range-value' }, '4096');

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
        h('label', {}, t('settings.temperature')),
        this.tempInput,
        this.tempValue,
      ]),
      h('div', { class: 'settings-row' }, [
        h('label', {}, t('settings.maxTokens')),
        this.maxTokensInput,
        this.maxTokensValue,
      ]),
      this.saveBtn,
    ]);

    const knowledgeSection = this._buildKnowledgeSection(knowledgeDocs);

    const statusSection = this._buildStatusSection(status, knowledgeDocs);

    mount(this.container, h('div', { class: 'settings-container' }, [
      aiConfigSection,
      knowledgeSection,
      statusSection,
    ]));
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
    const p = PROVIDERS.find((x) => x.value === provider);
    if (p && p.models.length) {
      this.modelInput.value = p.models[0];
    }
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
