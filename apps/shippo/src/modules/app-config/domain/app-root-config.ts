import { ShippingCategoryRule } from "./shipping-category-rule";
import { ShippoAppConfig } from "./shippo-app-config";

/**
 * Aggregates all Shippo configs for a given app installation plus the
 * channel<->config mapping so webhook handlers can resolve the right config
 * from an incoming event.
 *
 * `categoryRules` holds per-Saleor-category shipping rules (weight, parcel,
 * methods). Keyed by Saleor category slug. Carts whose lines belong to a
 * category without a matching rule fall back to the config's
 * `packageDefaults` + `{domestic,international}Services` legacy path.
 */
export class AppRootConfig {
  readonly configs: ReadonlyMap<string, ShippoAppConfig>;
  readonly channelMapping: ReadonlyMap<string, string>;
  readonly categoryRules: ReadonlyMap<string, ShippingCategoryRule>;

  constructor(
    configs: ReadonlyMap<string, ShippoAppConfig>,
    channelMapping: ReadonlyMap<string, string>,
    categoryRules: ReadonlyMap<string, ShippingCategoryRule> = new Map(),
  ) {
    this.configs = configs;
    this.channelMapping = channelMapping;
    this.categoryRules = categoryRules;
  }

  getConfigForChannel(channelSlugOrId: string): ShippoAppConfig | null {
    const configId = this.channelMapping.get(channelSlugOrId);

    if (!configId) return null;

    return this.configs.get(configId) ?? null;
  }

  getConfigById(configId: string): ShippoAppConfig | null {
    return this.configs.get(configId) ?? null;
  }

  getCategoryRule(categorySlug: string): ShippingCategoryRule | null {
    return this.categoryRules.get(categorySlug) ?? null;
  }
}
