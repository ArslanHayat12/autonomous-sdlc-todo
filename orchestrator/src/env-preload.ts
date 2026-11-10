/**
 * Loaded first from CLI/worker so repo-root `.env` is applied before the pipeline module graph initializes.
 */
import { bootstrapSdlcEnv, warnIfMissingOpenAiKey } from './bootstrap-env.js';

const repoRoot = bootstrapSdlcEnv();
warnIfMissingOpenAiKey(repoRoot);
