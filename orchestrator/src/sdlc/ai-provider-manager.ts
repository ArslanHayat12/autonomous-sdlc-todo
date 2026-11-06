import OpenAI from 'openai';
import type { AiConfig } from '../../sdlc.config.js';

export class AIProviderManager {
  constructor(private readonly cfg: AiConfig) {}

  createClient(): OpenAI | null {
    if (!process.env.OPENAI_API_KEY) return null;
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: this.cfg.requestTimeoutMs });
  }

  model(): string {
    return process.env.OPENAI_MODEL ?? this.cfg.defaultModel;
  }
}
