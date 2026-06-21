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
  const model = persisted.model || aiDefaults.model || process.env.AI_MODEL || 'gpt-4o';
  const baseUrl = persisted.baseUrl || aiDefaults.baseUrl || process.env.AI_BASE_URL || '';
  const temperature = 0.3;

  return { provider, model, apiKey, baseUrl, temperature };
}

export async function createChatModel(config) {
  const { provider, model, apiKey, baseUrl, temperature } = config;

  if (provider === 'openai' || provider === 'deepseek' || provider === 'openai_compat') {
    const { ChatOpenAI } = await import('@langchain/openai');
    const opts = { model, temperature, apiKey: apiKey || undefined };
    if (baseUrl) opts.configuration = { baseURL: baseUrl };
    else if (provider === 'deepseek') opts.configuration = { baseURL: 'https://api.deepseek.com' };
    return new ChatOpenAI(opts);
  }

  if (provider === 'anthropic') {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    return new ChatAnthropic({ model, temperature, apiKey: apiKey || undefined });
  }

  if (provider === 'ollama') {
    const { ChatOllama } = await import('@langchain/community/chat_models/ollama');
    return new ChatOllama({ model, temperature, baseUrl: baseUrl || 'http://localhost:11434' });
  }

  throw new Error(`不支持的 provider: ${provider}`);
}
