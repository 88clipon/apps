import { ShippingEasyConfig } from "./shippingeasy-config";

/**
 * Aggregates all ShippingEasy configs for a given app installation plus the
 * channel<->config mapping so webhook handlers can resolve the right config
 * from an incoming event.
 */
export class AppRootConfig {
  readonly configs: ReadonlyMap<string, ShippingEasyConfig>;
  readonly channelMapping: ReadonlyMap<string, string>;

  constructor(
    configs: ReadonlyMap<string, ShippingEasyConfig>,
    channelMapping: ReadonlyMap<string, string>,
  ) {
    this.configs = configs;
    this.channelMapping = channelMapping;
  }

  getConfigForChannel(channelSlugOrId: string): ShippingEasyConfig | null {
    const configId = this.channelMapping.get(channelSlugOrId);

    if (!configId) return null;

    return this.configs.get(configId) ?? null;
  }

  getConfigById(configId: string): ShippingEasyConfig | null {
    return this.configs.get(configId) ?? null;
  }
}
