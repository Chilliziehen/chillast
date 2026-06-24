import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

const ROOT = process.cwd();

function getUserDataDir() {
  const app = 'chillast';
  if (platform() === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), app);
  }
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', app);
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), app);
}

export async function loadConfig() {
  // 1. Read config.json for defaults
  const configPath = join(ROOT, 'config.json');
  const config = existsSync(configPath)
    ? JSON.parse(await readFile(configPath, 'utf-8'))
    : {};
  const aiDefaults = config.ai || {};

  // 2. Read persisted settings from userData/data/ai-settings.json
  const userDataDir = getUserDataDir();
  const settingsPath = join(userDataDir, 'data', 'ai-settings.json');
  const persisted = existsSync(settingsPath)
    ? JSON.parse(await readFile(settingsPath, 'utf-8'))
    : {};

  // 3. Read API key from userData/data/ai-credentials.json
  let apiKey = '';
  const credPath = join(userDataDir, 'data', 'ai-credentials.json');
  if (existsSync(credPath)) {
    try {
      const raw = await readFile(credPath, 'utf-8');
      // Try plain JSON first (our fallback format)
      try {
        const cred = JSON.parse(raw);
        apiKey = cred.apiKey || '';
      } catch (_) {
        console.warn('[config] credentials file is encrypted (safeStorage), cannot read outside Electron. Set OPENAI_API_KEY env var instead.');
      }
    } catch (_) {}
  }

  // 4. Fallback to env var
  if (!apiKey) {
    apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  }

  const provider = persisted.provider || aiDefaults.provider || process.env.AI_PROVIDER || 'openai';
  // Data cleaning/classification is high-volume → prefer a fast, cheap model,
  // INDEPENDENT of the app's chat model (provider/baseUrl/key still come from your
  // config, so it hits the same endpoint). Priority: CLEAN_MODEL env > persisted
  // cleanModel > config.ai.cleanModel > 'deepseek-v4-flash'.
  const model = process.env.CLEAN_MODEL
    || persisted.cleanModel
    || aiDefaults.cleanModel
    || 'deepseek-v4-flash';
  const baseUrl = persisted.baseUrl || aiDefaults.baseUrl || process.env.AI_BASE_URL || '';
  // Low temperature for faithful, deterministic cleaning.
  const temperature = Number(process.env.CLEAN_TEMPERATURE ?? 0.1);
  // Large output budget so cleaned chunks are never truncated. Without this the
  // provider's small default cap silently drops most of the content.
  const maxTokens = Number(process.env.CLEAN_MAX_TOKENS || 8192);

  return { provider, model, apiKey, baseUrl, temperature, maxTokens };
}

export async function createChatModel(config) {
  const { provider, model, apiKey, baseUrl, temperature, maxTokens } = config;

  if (provider === 'openai' || provider === 'deepseek' || provider === 'openai_compat') {
    const { ChatOpenAI } = await import('@langchain/openai');
    const opts = { model, temperature, apiKey: apiKey || undefined };
    if (maxTokens) opts.maxTokens = maxTokens;
    if (baseUrl) opts.configuration = { baseURL: baseUrl };
    else if (provider === 'deepseek') opts.configuration = { baseURL: 'https://api.deepseek.com' };
    return new ChatOpenAI(opts);
  }

  if (provider === 'anthropic') {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    return new ChatAnthropic({ model, temperature, apiKey: apiKey || undefined, maxTokens: maxTokens || 4096 });
  }

  if (provider === 'ollama') {
    const { ChatOllama } = await import('@langchain/community/chat_models/ollama');
    const opts = { model, temperature, baseUrl: baseUrl || 'http://localhost:11434' };
    if (maxTokens) opts.numPredict = maxTokens;
    return new ChatOllama(opts);
  }

  throw new Error(`不支持的 provider: ${provider}`);
}
