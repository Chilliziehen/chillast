# tools/ — 占星知识库数据清洗工具

## 使用方法

1. 将原始占星文档（PDF/MD/TXT）放入 `raw-knowledge/` 目录
2. 运行：
   ```bash
   node tools/clean-knowledge.mjs
   ```
3. 清洗后的文档输出到 `assets/knowledge/builtin/`
4. 删除 `userData/data/vector-index/` 目录以重建向量索引

## 环境变量

如果无法从应用配置读取 API Key，设置环境变量：
```bash
set OPENAI_API_KEY=sk-...
```

## 自定义指令

可以传入自定义清洗指令：
```bash
node tools/clean-knowledge.mjs "只清洗关于行星落座的文档，忽略其他内容"
```
