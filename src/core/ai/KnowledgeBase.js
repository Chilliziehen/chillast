'use strict';

const path = require('path');
const fs = require('fs');
const esm = require('./esm-bridge');

class KnowledgeBase {
  constructor(modelProvider) {
    this._mp = modelProvider;
    this._store = null;
    this._docs = [];
  }

  async initialize(builtinPath, userDataPath) {
    const embeddings = this._mp.embeddings();
    if (!embeddings) return; // provider doesn't support embeddings (e.g. Anthropic alone)

    const { RecursiveCharacterTextSplitter } = await esm.load('langchain/text_splitter');
    const { HNSWLib } = await esm.load('@langchain/community/vectorstores/hnswlib');

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ['\n## ', '\n### ', '\n\n', '\n', '。', ''],
    });

    const allChunks = [];

    const loadDir = async (dir, source) => {
      if (!dir || !fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') || f.endsWith('.txt'));
      for (const f of files) {
        const filePath = path.join(dir, f);
        const content = fs.readFileSync(filePath, 'utf-8');
        const docs = await splitter.createDocuments(
          [content],
          [{ source, fileName: f }],
        );
        allChunks.push(...docs);
        this._docs.push({ id: filePath, name: f, source, importedAt: new Date().toISOString() });
      }
    };

    await loadDir(builtinPath, 'builtin');
    if (userDataPath) {
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }
      await loadDir(userDataPath, 'user');
    }

    if (allChunks.length) {
      this._store = await HNSWLib.fromDocuments(allChunks, embeddings);
    }
  }

  async retrieve(query, k = 6) {
    if (!this._store) return [];
    const results = await this._store.similaritySearch(query, k);
    return results.map((r) => ({
      content: r.pageContent,
      source: r.metadata.source || 'unknown',
      fileName: r.metadata.fileName || '',
    }));
  }

  listDocuments() {
    return [...this._docs];
  }

  isReady() {
    return this._store !== null;
  }
}

module.exports = KnowledgeBase;
