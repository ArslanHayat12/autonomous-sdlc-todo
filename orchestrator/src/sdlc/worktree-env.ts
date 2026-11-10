/** Env for child processes in isolated worktrees (avoid Husky/prepare hangs; keep secrets from parent). */
export function sdlcChildProcessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.HUSKY = '0';
  return env;
}
