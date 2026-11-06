import { loadMergedConfigFromRepoRoot, type SdlcConfigWithFeatures } from './feature-flags.js';

export class ConfigurationManager {
  /** Pass monorepo root (directory containing `sdlc.features.json`). */
  async get(repoRoot: string): Promise<SdlcConfigWithFeatures> {
    return loadMergedConfigFromRepoRoot(repoRoot);
  }
}
