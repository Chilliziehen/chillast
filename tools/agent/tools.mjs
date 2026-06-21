import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const ROOT = process.cwd();
const INPUT_DIR = join(ROOT, 'tools', 'raw-knowledge');
const OUTPUT_DIR = join(ROOT, 'assets', 'knowledge', 'builtin');

// Tool 1: List available raw .p.txt files
const listFilesTool = new DynamicStructuredTool({
  name: 'list_raw_documents',
  description: '列出 tools/raw-knowledge/ 目录中所有可用的原始文档文件名（仅 .p.txt 格式的 OCR 纯文本文件）。',
  schema: z.object({}),
  func: async () => {
    if (!existsSync(INPUT_DIR)) {
      return 'tools/raw-knowledge/ 目录不存在。请先创建并放入原始文档。';
    }
    const files = await readdir(INPUT_DIR);
    const valid = files.filter(f => /\.p\.txt$/i.test(f));
    if (!valid.length) return '目录中没有 .p.txt 文件。请放入 OCR 提取的纯文本文件。';
    return `可用文件 (${valid.length}):\n${valid.map(f => `  - ${f}`).join('\n')}`;
  },
});

// Tool 2: Read a raw .p.txt document
const readFileTool = new DynamicStructuredTool({
  name: 'read_document',
  description: '读取原始占星文档文件（.p.txt 格式的 OCR 纯文本）。输入完整文件名，返回文件全文内容。注意：文本来自 OCR，可能包含乱码、错字、断行等问题，需要清洗修复。',
  schema: z.object({
    filename: z.string().describe('.p.txt 文件名，如 [OCR]_内在的宇宙_20260621_1241.p.txt'),
  }),
  func: async (input) => {
    const filePath = join(INPUT_DIR, input.filename);
    if (!existsSync(filePath)) {
      return `文件不存在: ${input.filename}。请先调用 list_raw_documents 查看可用文件。`;
    }
    const content = await readFile(filePath, 'utf-8');
    // Truncate to ~50000 chars to stay within LLM context limits
    if (content.length > 50000) {
      return content.slice(0, 50000) + '\n\n[... 文档较长，已截断。如需处理后半部分，请说明。]';
    }
    return content;
  },
});

// Tool 3: Write a cleaned knowledge document
const writeFileTool = new DynamicStructuredTool({
  name: 'write_knowledge_doc',
  description: '将清洗后的占星知识文档写入 assets/knowledge/builtin/ 目录。文件名必须使用 kebab-case + 领域前缀，如 planets-in-signs.md。内容必须遵循知识库格式规范（# 标题 + 概述 + ## 主题区块 + ### 子主题）。',
  schema: z.object({
    filename: z.string().describe('输出文件名，kebab-case，如 planets-in-signs.md'),
    content: z.string().describe('清洗后的 Markdown 全文，遵循知识库 Spec 格式'),
  }),
  func: async (input) => {
    if (!existsSync(OUTPUT_DIR)) {
      await mkdir(OUTPUT_DIR, { recursive: true });
    }
    const filePath = join(OUTPUT_DIR, input.filename);
    await writeFile(filePath, input.content, 'utf-8');
    return `已写入: ${filePath} (${input.content.length} 字符)`;
  },
});

export const allTools = [listFilesTool, readFileTool, writeFileTool];
