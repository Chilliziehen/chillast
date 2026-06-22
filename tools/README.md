# tools/ — 通用知识库构建流水线

把 OCR 提取的书籍纯文本，**分块清洗 → 按领域拆分**，构建成高质量的 RAG 知识库。
**通用、按领域（corpus）配置**：占星、八字、紫微斗数、印度占星…同一套引擎，配置驱动。

```
tools/raw-knowledge/<corpus>/*.p.txt ─Stage1 清洗─▶ tools/cleaned/<corpus>/*.md ─Stage2 拆分─▶ assets/knowledge/builtin/<corpus>-书名-领域.md
```

## 多领域（corpus）

每个知识领域是 `tools/corpora/<id>.mjs` 里的一份配置，只声明**领域相关**的部分：
清洗提示词要素（`clean.subject/preserve/fixHint`）、子领域分类法（`domains: [{id, zh, desc, kw}]`）。
目录按 id 约定派生，引擎完全通用。已内置：

| id | 名称 | 子领域 |
|----|------|--------|
| `astrology` | 西方占星 | planets-signs/houses, aspects, patterns, retrograde, transit, synastry |
| `bazi` | 八字命理 | ganzhi, wuxing, shishen, geju, dayun, shensha, pillars |
| `ziwei` | 紫微斗数 | stars, palaces, sihua, geju, daxian |
| `vedic` | 印度占星 | grahas, rashis, bhavas, nakshatra, dasha, yoga, aspects |

所有命令用 `--corpus <id>` 选择领域（默认 `astrology`）。
**新增一个知识领域 = 在 `tools/corpora/` 放一个 `<id>.mjs` + 在 `corpora/index.mjs` 的 `CORPUS_IDS` 加上 id**，无需改引擎。

> 目录约定：`astrology` 沿用旧的扁平目录（`tools/raw-knowledge/`、`tools/cleaned/`）；其余领域用
> 子目录 `tools/raw-knowledge/<id>/`、`tools/cleaned/<id>/`。输出统一进 `assets/knowledge/builtin/`，
> 文件名带 `<id>-` 前缀且带 `<!-- domain: X -->` 标记，多领域可共存于同一知识库。

## 为什么分两段

整本书（常达 25 万~35 万字）一次性丢给 LLM，会被**输出 token 上限**截断，模型只能“摘要”，
导致大量信息丢失。本流水线针对性解决：

- **Stage 1（清洗，近无损）**：把每本书按段落切成小块（默认每块 ~4500 字），**每块独立**清洗，
  指令严格要求“逐句保留、只修复 OCR 与排版、禁止概括删减”，再按原序拼接。模型每次只看一小块，
  物理上无法丢内容。结束打印每本书的**保留率**（输出/输入字符）。
- **Stage 2（按领域拆分，无损路由）**：把清洗好的整书按 `##/###` 切成段落单元，用 LLM（带关键词
  兜底）判定每段所属领域（行星落座 / 落宫 / 相位 / 格局 / 逆行 / 行运 / 合盘 / 命理 / 综合），
  按 (书, 领域) 归类写出。只是“搬运”段落、不改写，结束会校验**内容保全率**（应接近 100%）。
  每个输出文件带 `<!-- domain: X -->` 标记，知识库据此精确分类（不再靠标题猜）。

## 用法

```bash
# 一键完成两步（推荐）。--corpus 默认 astrology
node tools/build-knowledge.mjs --corpus bazi
node tools/build-knowledge.mjs --corpus bazi --force      # 忽略 cleaned 缓存，重新清洗
node tools/build-knowledge.mjs --corpus bazi 子平          # 仅处理文件名匹配的书

# 或分步运行（可在两步之间插入去噪）
node tools/clean-knowledge.mjs   --corpus bazi            # Stage 1 → tools/cleaned/bazi/
node tools/denoise-cleaned.mjs   --corpus bazi --apply    # 可选：保守去噪（图书信息/页码等）
node tools/split-knowledge.mjs   --corpus bazi            # Stage 2 → assets/knowledge/builtin/
```

新领域准备：把该领域的 OCR `.p.txt` 放进 `tools/raw-knowledge/<id>/`。完成后删除
`userData/data/vector-index/` 目录以重建向量索引（或 `npm run build:index` 预建）。

## 环境变量

API Key（无法从应用配置读取时）：
```bash
set OPENAI_API_KEY=sk-...      # 或 ANTHROPIC_API_KEY
```

| 变量 | 默认 | 阶段 | 说明 |
|------|------|------|------|
| `CLEAN_CHUNK_CHARS` | 4500 | 1 | 每块原文字符数。调小更稳但调用更多。 |
| `CLEAN_CONCURRENCY` | 4 | 1 | 并发清洗的块数。受供应商速率限制。 |
| `CLEAN_MAX_TOKENS` | 8192 | 1/2 | 单次输出 token 上限。**避免截断的关键。** |
| `CLEAN_TEMPERATURE` | 0.1 | 1/2 | 采样温度，越低越忠实。 |
| `SPLIT_SEG_CHARS` | 3500 | 2 | 分类单元的最大字符数。 |
| `SPLIT_BATCH` | 18 | 2 | 每次 LLM 分类的段落数（只发标题+摘要，便宜）。 |
| `SPLIT_CONCURRENCY` | 3 | 2 | 并发分类批数。 |
| `AI_PROVIDER` / `AI_MODEL` / `AI_BASE_URL` | 取应用配置 | — | 覆盖供应商/模型/端点。 |

## 健壮性

- **断点续跑**：Stage 1 已清洗过的书会自动跳过（`--force` 强制重清）。
- **重试**：每次 LLM 调用失败自动重试（线性退避），清洗块彻底失败时**保留原文**而非丢弃。
- **自检**：Stage 1 报告保留率，Stage 2 报告内容保全率与各领域段落数，低于阈值会标 ⚠。
- **产物清单**：Stage 2 在 `assets/knowledge/builtin/_manifest.json` 写出每本书的拆分明细。

> 说明：清洗一本大书会产生几十次 LLM 调用（chunk 数），这是无损清洗的必要代价。
> 嫌慢调大并发，担心截断调小 `CLEAN_CHUNK_CHARS`。

## 发布：预置模型 + 预建索引（开箱即用·离线）

让安装包自带嵌入模型和向量索引，用户装好即用、零下载、零构建：

```bash
node tools/split-knowledge.mjs       # 1. 确保 assets/knowledge/builtin/ 已是最终知识
npm run build:index                  # 2. 下模型到 resources/models/，建索引到 resources/vector-index/
#   HF_ENDPOINT=https://hf-mirror.com npm run build:index   # 国内走镜像
npm run dist                         # 3. electron-builder 把上面两者打进安装包
```

打包后运行时（`package.json` build 段已配好）：
- `extraResources` 把 `resources/models`、`resources/vector-index` 放到安装目录的 `resources/`；
- `asarUnpack` 解出 worker 与原生件（onnxruntime-node / @huggingface/transformers / hnswlib-node）；
- 首次启动：[Main.js](../src/main/Main.js) 把自带索引拷到 userData、并让嵌入用自带模型 `offline` 加载 → 秒开、离线。

注意：模型与索引是**一对**（同模型同维度）。换知识库或换模型后，重跑 `npm run build:index` 重新生成。`resources/` 已被 gitignore（按需生成，不入库）。

## 旧版 ReAct Agent（已弃用）

`agent/prompt.mjs` 与 `agent/tools.mjs` 是早期基于 LangGraph ReAct 的实现，会让模型一次吞下整本书
而丢失信息，**已不再被任何脚本使用**，仅作参考保留。当前实现见 `agent/pipeline.mjs`（清洗）与
`agent/classify.mjs`（拆分），共用 `agent/util.mjs`。
