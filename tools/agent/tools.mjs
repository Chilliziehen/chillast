import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname } from 'path';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const ROOT = process.cwd();
const INPUT_DIR = join(ROOT, 'tools', 'raw-knowledge');
const OUTPUT_DIR = join(ROOT, 'assets', 'knowledge', 'builtin');

// Tool 1: List available raw files
const listFilesTool = new DynamicStructuredTool({
  name: 'list_raw_documents',
  description: '列出 tools/raw-knowledge/ 目录中所有可用的原始文档文件名。',
  schema: z.object({}),
  func: async () => {
    if (!existsSync(INPUT_DIR)) {
      return 'tools/raw-knowledge/ 目录不存在。请先创建并放入原始文档。';
    }
    const files = await readdir(INPUT_DIR);
    const valid = files.filter(f => /\.(md|txt|pdf)$/i.test(f));
    if (!valid.length) return '目录为空。请放入 .md / .txt / .pdf 格式的原始文档。';
    return `可用文件 (${valid.length}):\n${valid.map(f => `  - ${f}`).join('\n')}`;
  },
});

// Tool 2: Read a raw document file
const readFileTool = new DynamicStructuredTool({
  name: 'read_document',
  description: '读取原始占星文档文件。输入文件名（位于 tools/raw-knowledge/ 目录），返回文件全文内容。支持 .md, .txt, .pdf 格式。',
  schema: z.object({
    filename: z.string().describe('文件名，如 aspects-guide.pdf 或 planets.md'),
  }),
  func: async (input) => {
    const filePath = join(INPUT_DIR, input.filename);
    if (!existsSync(filePath)) {
      return `文件不存在: ${input.filename}。请检查 tools/raw-knowledge/ 目录中的可用文件。`;
    }
    const ext = extname(filePath).toLowerCase();
    if (ext === '.pdf') {
      const pdfParse = (await import('pdf-parse')).default;
      const buffer = await readFile(filePath);
      const data = await pdfParse(buffer);
      return data.text;
    }
    return await readFile(filePath, 'utf-8');
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
