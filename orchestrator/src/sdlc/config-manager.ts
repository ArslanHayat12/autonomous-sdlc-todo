import { sdlcConfig, type SdlcConfig } from '../../sdlc.config.js';

export class ConfigurationManager {
  get(): SdlcConfig {
    return sdlcConfig;
  }
}
