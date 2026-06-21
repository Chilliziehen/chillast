# 占星知识库条目格式 · Knowledge Base Entry Format Spec

> 日期：2026-06-21
> 分支：`feat/enhance_ai`
> 状态：待 review

## 1. 概述

本规范定义占星知识库中文档的结构化格式，用于向量检索（RAG）和 LLM 知识增强。所有知识库文档以 Markdown 文件存储在 `assets/knowledge/builtin/`（内置）或用户导入目录中。

## 2. 文件命名

| 规则 | 说明 | 示例 |
|------|------|------|
| 小写连字符 | kebab-case | `planets-in-signs.md` |
| 领域前缀 | 按内容分类 | `bazi-` / `synastry-` / `transit-` |
| `.md` 扩展名 | 仅支持 Markdown | — |

## 3. Markdown 结构

每个文件遵循以下层级：

```markdown
# 文档标题

简短的文档概述（1-2 句话），描述本文档覆盖的内容范围。

## 主题区块 1

### 子主题 1.1
详细内容...

### 子主题 1.2
详细内容...

## 主题区块 2

### 子主题 2.1
详细内容...
```

### 分块规则

- `RecursiveCharacterTextSplitter` 按 `## ` → `### ` → `\n\n` → `\n` → `。` 优先级切分
- `chunkSize: 1000` 字符，`chunkOverlap: 200` 字符
- 每个 chunk 继承所在文件的 `source` / `fileName` / `domain` 元数据
- 切分优先在 `##` 和 `###` 标题边界进行，确保语义完整性

## 4. 领域分类（domain）

`_extractDomain()` 从文档标题自动推断领域标签：

| domain 值 | 标题关键词 | 说明 |
|-----------|-----------|------|
| `planets-signs` | 行星、落座 | 行星落入星座的含义 |
| `planets-houses` | 宫位、落宫 | 行星落入宫位的含义 |
| `aspects` | 相位 | 行星间相位的解读 |
| `patterns` | 格局 | 大三角、大十字等特殊格局 |
| `retrograde` | 逆行 | 行星逆行的含义 |
| `transit` | 行运 | 行运盘解读指南 |
| `synastry` | 合盘 | 关系盘解读 |
| `bazi` | 八字、命理 | 中式命理 |
| `general` | （其他） | 通用占星知识 |

## 5. 检索结果格式

`search_knowledge` 工具返回给 LLM 的格式：

```
[参考1] (领域: planets-signs, 来源: planets-in-signs.md)
太阳白羊座：充满开创精神与行动力，性格直率果断...

---

[参考2] (领域: aspects, 来源: aspects-interpretation.md)
合相：两行星黄经接近，能量融合...
```

LLM 通过领域标签判断知识类型，通过来源标注可追溯原文文件。

## 6. 向量索引持久化

- 索引存储在 `userData/data/vector-index/` 目录
- 首次启动：从文档构建索引并 `save()` 到磁盘
- 后续启动：先尝试 `load()` 磁盘索引，失败则重建
- 用户导入新文档后：`addDocuments()` + `save()` 更新磁盘索引
- 删除文档：仅从元数据列表移除（HNSWLib 不支持向量级删除，需重建索引清除残留）

## 7. 配置项

| 配置 | 位置 | 默认值 | 说明 |
|------|------|--------|------|
| `ai.enableRag` | `config.json` / `ai-settings.json` | `true` | 设为 `false` 时跳过整个 KB 初始化 |
| `ai.ragTopK` | `config.json` / `ai-settings.json` | `6` | interpret 链的检索返回数 |
| `search_knowledge` k | 硬编码 | `4` | agent 工具调用的检索返回数 |

## 8. 新增知识文档指南

1. 在 `assets/knowledge/builtin/` 创建 `.md` 文件
2. 遵循 §3 的 Markdown 结构，确保 `##` 标题清晰
3. 文件标题（`#` 行）应包含领域关键词（如"行星落座"、"相位解读"），以便自动分类
4. 每个子主题 200-500 字，保持语义自包含
5. 避免在单个文件中混合多个不相关领域
6. 提交后删除 `userData/data/vector-index/` 目录强制重建索引

## 9. 不在本次范围内

- ❌ 相关性阈值过滤（当前始终返回 top-k 结果）
- ❌ 向量级文档删除（需 HNSWLib 重建支持）
- ❌ 多语言知识库（当前仅中文）
- ❌ 知识库版本控制和增量更新
