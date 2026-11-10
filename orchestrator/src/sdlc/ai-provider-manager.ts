import OpenAI from 'openai';
import type { AiConfig } from '../../sdlc.config.js';

function resolveOpenAiKey(): string | null {
  let raw = process.env.OPENAI_API_KEY?.trim() ?? '';
  if (!raw) return null;
  // Common typo: OPENAI_API_KEY=Y=sk-...
  if (raw.startsWith('Y=') && raw.length > 2) raw = raw.slice(2).trim();
  if (!raw) return null;
  return raw;
}

export class AIProviderManager {
  constructor(private readonly cfg: AiConfig) {}

  createClient(): OpenAI | null {
    const apiKey = resolveOpenAiKey();
    if (!apiKey) return null;
    return new OpenAI({ apiKey, timeout: this.cfg.requestTimeoutMs });
  }

  model(): string {
    return process.env.OPENAI_MODEL ?? this.cfg.defaultModel;
  }
}
