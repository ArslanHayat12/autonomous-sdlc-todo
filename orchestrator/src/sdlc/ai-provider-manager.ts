import OpenAI from 'openai';
import type { AiConfig } from '../../sdlc.config.js';
import { normalizeOpenAiKey } from '../load-env.js';

export class AIProviderManager {
  constructor(private readonly cfg: AiConfig) {}

  createClient(): OpenAI | null {
    const apiKey = normalizeOpenAiKey(process.env.OPENAI_API_KEY);
    if (!apiKey) return null;
    return new OpenAI({ apiKey, timeout: this.cfg.requestTimeoutMs });
  }

  model(): string {
    return process.env.OPENAI_MODEL ?? this.cfg.defaultModel;
  }
}
