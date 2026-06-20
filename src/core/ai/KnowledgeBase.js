'use strict';

const path = require('path');
const fs = require('fs');
const esm = require('./esm-bridge');

class KnowledgeBase {
  constructor(modelProvider) {
    this._mp = modelProvider;
    this._store = null;
    this._docs = [];
    this._userPath = null;
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
      this._userPath = userDataPath;
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

  async importDocuments(filePaths) {
    const embeddings = this._mp.embeddings();
    if (!embeddings) throw new Error('当前模型不支持嵌入，无法导入文档');

    const { RecursiveCharacterTextSplitter } = await esm.load('langchain/text_splitter');
    const { HNSWLib } = await esm.load('@langchain/community/vectorstores/hnswlib');

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ['\n## ', '\n### ', '\n\n', '\n', '。', ''],
    });

    const allChunks = [];
    for (const filePath of filePaths) {
      const path = require('path');
      const f = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      if (ext !== '.md' && ext !== '.txt' && ext !== '.pdf') continue;

      let content;
      if (ext === '.pdf') {
        const pdfParse = require('pdf-parse');
        const buffer = require('fs').readFileSync(filePath);
        const pdfData = await pdfParse(buffer);
        content = pdfData.text;
      } else {
        content = require('fs').readFileSync(filePath, 'utf-8');
      }

      const docs = await splitter.createDocuments([content], [{ source: 'user', fileName: f }]);
      allChunks.push(...docs);
      this._docs.push({ id: filePath, name: f, source: 'user', importedAt: new Date().toISOString() });
    }

    if (allChunks.length && this._store) {
      await this._store.addDocuments(allChunks);
    } else if (allChunks.length) {
      this._store = await HNSWLib.fromDocuments(allChunks, embeddings);
    }

    return allChunks.length;
  }

  removeDocument(docId) {
    const idx = this._docs.findIndex((d) => d.id === docId);
    if (idx === -1) return false;
    this._docs.splice(idx, 1);
    return true;
  }
}

module.exports = KnowledgeBase;
