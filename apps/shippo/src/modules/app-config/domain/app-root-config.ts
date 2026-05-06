import { ShippoAppConfig } from "./shippo-app-config";

/**
 * Aggregates all Shippo configs for a given app installation plus the
 * channel<->config mapping so webhook handlers can resolve the right config
 * from an incoming event.
 */
export class AppRootConfig {
  readonly configs: ReadonlyMap<string, ShippoAppConfig>;
  readonly channelMapping: ReadonlyMap<string, string>;

  constructor(
    configs: ReadonlyMap<string, ShippoAppConfig>,
    channelMapping: ReadonlyMap<string, string>,
  ) {
    this.configs = configs;
    this.channelMapping = channelMapping;
  }

  getConfigForChannel(channelSlugOrId: string): ShippoAppConfig | null {
    const configId = this.channelMapping.get(channelSlugOrId);

    if (!configId) return null;

    return this.configs.get(configId) ?? null;
  }

  getConfigById(configId: string): ShippoAppConfig | null {
    return this.configs.get(configId) ?? null;
  }
}
