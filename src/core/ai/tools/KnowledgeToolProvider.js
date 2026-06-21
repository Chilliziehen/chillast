'use strict';

const ToolProvider = require('./ToolProvider');
const esm = require('../esm-bridge');

/**
 * KnowledgeToolProvider — exposes the RAG knowledge base as a `search_knowledge`
 * tool the agent can call on demand. Replaces the ad-hoc RAG tool that used to
 * be injected inside ChainFactory. Becomes unready (contributes no tools) when
 * the knowledge base has no embeddings available.
 */
class KnowledgeToolProvider extends ToolProvider {
  constructor(knowledgeBase) {
    super('kb', 'knowledge');
    this._kb = knowledgeBase;
  }

  isReady() {
    return !!(this._kb && this._kb.isReady());
  }

  async _build() {
    if (!this.isReady()) return [];
    const { DynamicStructuredTool } = await esm.load('@langchain/core/tools');
    const z = require('zod');
    const kb = this._kb;

    const searchKnowledge = new DynamicStructuredTool({
      name: 'search_knowledge',
      description: '搜索占星/命理知识库，查找关于某个主题的专业知识。用中文关键词搜索。',
      schema: z.object({ query: z.string().describe('搜索关键词，如"太阳在白羊座"') }),
      func: async (input) => {
        const docs = await kb.retrieve(input.query, 4);
        if (!docs.length) return '未找到相关知识';
        return docs.map((d, i) =>
          `[参考${i + 1}] (领域: ${d.domain || '通用'}, 来源: ${d.fileName || d.source})\n${d.content}`
        ).join('\n\n---\n\n');
      },
    });

    return [searchKnowledge];
  }
}

module.exports = KnowledgeToolProvider;
