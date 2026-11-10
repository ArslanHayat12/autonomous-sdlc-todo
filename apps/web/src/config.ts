const DEFAULT_API = 'http://localhost:4000';

export function apiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL;
  return typeof fromEnv === 'string' && fromEnv.trim() ? fromEnv.trim() : DEFAULT_API;
}

export const TITLE_MAX_LENGTH = 160;
