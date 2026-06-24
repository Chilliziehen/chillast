#!/usr/bin/env node
//
// stage-index.mjs — 把"应用当前正在用的"嵌入模型 + 向量索引同步到 resources/，供
// electron-builder 打包（extraResources）。这样发布的安装包自带最新、开箱即用的向量库。
//
//   node tools/stage-index.mjs          # 从 userData 同步最新索引+模型 → resources/
//   npm run stage:index                 # 同上
//
// 来源 = 应用数据目录里的 data/vector-index 与 data/models（app 启动时建好的那份）。
// 若你刚往 assets/knowledge/builtin/ 加了新知识，请先让索引重建（删 userData 的
// vector-index 后启动 app，或 npm run build:index），再跑本脚本。

import { cp, mkdir, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

function userDataDir() {
  const app = 'chillast';
  if (platform() === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), app);
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', app);
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), app);
}

const ROOT = process.cwd();
const RES = join(ROOT, 'resources');
const liveData = join(userDataDir(), 'data');
const liveIndex = join(liveData, 'vector-index');
const liveModels = join(liveData, 'models');

async function main() {
  console.log('📦 同步打包资源（模型 + 向量索引）→ resources/\n');

  if (!existsSync(join(liveIndex, 'docstore.json'))) {
    console.error(`✗ 未找到应用的向量索引：${liveIndex}`);
    console.error('  请先让它生成：删除该目录后启动 app 让其重建，或运行 npm run build:index。');
    process.exit(1);
  }

  // —— 向量索引 ——
  await rm(join(RES, 'vector-index'), { recursive: true, force: true });
  await mkdir(join(RES, 'vector-index'), { recursive: true });
  for (const f of ['args.json', 'docstore.json', 'hnswlib.index']) {
    if (!existsSync(join(liveIndex, f))) { console.error(`✗ 索引缺少文件: ${f}`); process.exit(1); }
    await cp(join(liveIndex, f), join(RES, 'vector-index', f));
  }
  const chunks = JSON.parse(await readFile(join(RES, 'vector-index', 'docstore.json'), 'utf8')).length;
  const args = JSON.parse(await readFile(join(RES, 'vector-index', 'args.json'), 'utf8'));
  console.log(`✓ 向量索引 → resources/vector-index（${chunks} 片段，${args.numDimensions} 维/${args.space}）`);

  // —— 嵌入模型（仅在 resources 还没有时同步）——
  if (existsSync(join(liveModels, 'Xenova'))) {
    if (!existsSync(join(RES, 'models', 'Xenova'))) {
      await mkdir(join(RES, 'models'), { recursive: true });
      await cp(join(liveModels, 'Xenova'), join(RES, 'models', 'Xenova'), { recursive: true });
      console.log('✓ 嵌入模型 → resources/models');
    } else {
      console.log('· 嵌入模型已在 resources/models（跳过）');
    }
  } else {
    console.log('⚠ 未在 userData 找到模型；确认 resources/models 已存在，否则离线加载会失败。');
  }

  console.log('\n下一步：npm run dist（打包前请关闭正在运行的 CHILLAST，避免原生模块被锁）。');
}

main().catch((e) => { console.error('✗ 错误:', e.message); process.exit(1); });
