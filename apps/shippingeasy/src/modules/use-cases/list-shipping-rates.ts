import { err, ok, Result } from "neverthrow";

import { createLogger } from "@/lib/logger";
import { ShippingEasyConfig } from "@/modules/app-config/domain/shippingeasy-config";
import { AppConfigRepo } from "@/modules/app-config/repositories/app-config-repo";
import { SaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { ShippoClient, ShippoRate } from "@/modules/shippo/shippo-client";

import { bucketWeight, RateCache } from "./rate-cache";

const logger = createLogger("ListShippingRates");

/** Hard checkout-time budget. */
const DEFAULT_TIMEOUT_MS = 5_000;
/** How long returned rates stay warm in cache. */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Matches the shape Saleor's SHIPPING_LIST_METHODS_FOR_CHECKOUT schema expects. */
export type SaleorShippingMethodResponseItem = {
  id: string;
  name: string;
  amount: number;
  currency: string;
  maximum_delivery_days?: number;
  minimum_delivery_days?: number;
  description?: string;
};

export type ListShippingRatesInput = {
  saleorApiUrl: SaleorApiUrl;
  appId: string;
  channelSlug: string;
  checkoutCurrency: string;
  shippingAddress: {
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    streetAddress1: string;
    streetAddress2?: string | null;
    city: string;
    postalCode: string;
    countryArea?: string | null;
    countryCode: string;
    phone?: string | null;
  } | null;
  totalWeightOunces: number;
};

export const ListShippingRatesError = {
  NotConfigured: "NOT_CONFIGURED",
  ConfigError: "CONFIG_ERROR",
  UpstreamError: "UPSTREAM_ERROR",
} as const;

export type ListShippingRatesErrorCode =
  (typeof ListShippingRatesError)[keyof typeof ListShippingRatesError];

export class ListShippingRatesUseCase {
  constructor(
    private readonly deps: {
      configRepo: AppConfigRepo;
      rateCache: RateCache;
      buildShippoClient: (config: ShippingEasyConfig) => ShippoClient | null;
      timeoutMs?: number;
    },
  ) {}

  async execute(
    input: ListShippingRatesInput,
  ): Promise<Result<SaleorShippingMethodResponseItem[], { code: ListShippingRatesErrorCode; message: string }>> {
    logger.info("execute called", {
      channel: input.channelSlug,
      country: input.shippingAddress?.countryCode,
      postalCode: input.shippingAddress?.postalCode,
    });

    if (!input.shippingAddress) {
      return ok([]);
    }

    const configResult = await this.deps.configRepo.getConfigByChannel({
      saleorApiUrl: input.saleorApiUrl,
      appId: input.appId,
      channelSlug: input.channelSlug,
    });

    if (configResult.isErr()) {
      logger.warn("Config error", { message: configResult.error.message });

      return err({ code: ListShippingRatesError.ConfigError, message: configResult.error.message });
    }

    const config = configResult.value;

    if (!config) {
      logger.warn("No config for channel", { channel: input.channelSlug });

      return err({ code: ListShippingRatesError.NotConfigured, message: "No config for channel" });
    }

    const shippoClient = this.deps.buildShippoClient(config);

    if (!shippoClient) {
      logger.warn("No Shippo API token configured; set shippoApiToken in app settings to enable real-time rates");

      return ok([]);
    }

    const weightBucket = bucketWeight(input.totalWeightOunces);
    const cacheKey = {
      saleorApiUrl: input.saleorApiUrl,
      appId: input.appId,
      channelSlug: input.channelSlug,
      country: input.shippingAddress.countryCode,
      postalCode: input.shippingAddress.postalCode,
      weightBucketOz: weightBucket,
    };

    const cached = await this.deps.rateCache.get(cacheKey);

    if (cached) {
      logger.debug("Rate cache hit", { channelSlug: input.channelSlug, weightBucketOz: weightBucket });

      return ok(
        this.toSaleorShape({
          rates: cached.rates,
          config,
          checkoutCurrency: input.checkoutCurrency,
          destinationCountry: input.shippingAddress.countryCode,
        }),
      );
    }

    const result = await shippoClient.getRates(
      {
        toAddress: {
          name: `${input.shippingAddress.firstName ?? ""} ${input.shippingAddress.lastName ?? ""}`.trim(),
          company: input.shippingAddress.companyName ?? "",
          street1: input.shippingAddress.streetAddress1,
          street2: input.shippingAddress.streetAddress2 ?? "",
          city: input.shippingAddress.city,
          state: input.shippingAddress.countryArea ?? "",
          zip: input.shippingAddress.postalCode,
          country: input.shippingAddress.countryCode,
          phone: input.shippingAddress.phone ?? "",
        },
        fromAddress: {
          name: config.originAddress.name,
          company: config.originAddress.company ?? "",
          street1: config.originAddress.street1,
          street2: config.originAddress.street2 ?? "",
          city: config.originAddress.city,
          state: config.originAddress.state,
          zip: config.originAddress.postalCode,
          country: config.originAddress.country,
          phone: config.originAddress.phone ?? "",
        },
        parcel: {
          weightOunces: Math.max(weightBucket, config.packageDefaults.weightOunces),
          lengthInches: config.packageDefaults.lengthInches,
          widthInches: config.packageDefaults.widthInches,
          heightInches: config.packageDefaults.heightInches,
        },
      },
      { timeoutMs: this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    );

    if (result.isErr()) {
      const errName = (result.error as { _internalName?: string })._internalName ?? result.error.message;

      logger.warn("Shippo API error", { errName, message: result.error.message });

      if (
        errName === "ShippoApiError.Timeout" ||
        errName === "ShippoApiError.NetworkError" ||
        errName === "ShippoApiError.ServerError"
      ) {
        logger.warn("Shippo rates call failed; returning empty list", { error: result.error.message });

        return ok([]);
      }

      return err({ code: ListShippingRatesError.UpstreamError, message: result.error.message });
    }

    logger.info("Shippo returned rates", {
      count: result.value.rates.length,
      rates: result.value.rates.map((r) => `${r.provider}/${r.servicelevel.token}=${r.amount}${r.currency}`),
    });

    await this.deps.rateCache.set(cacheKey, {
      rates: [...result.value.rates],
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return ok(
      this.toSaleorShape({
        rates: result.value.rates,
        config,
        checkoutCurrency: input.checkoutCurrency,
        destinationCountry: input.shippingAddress.countryCode,
      }),
    );
  }

  private toSaleorShape({
    rates,
    config,
    checkoutCurrency,
    destinationCountry,
  }: {
    rates: readonly ShippoRate[];
    config: ShippingEasyConfig;
    checkoutCurrency: string;
    destinationCountry: string;
  }): SaleorShippingMethodResponseItem[] {
    const isDomestic =
      destinationCountry.toUpperCase() === config.originAddress.country.toUpperCase();
    const serviceAllowlist = isDomestic ? config.domesticServices : config.internationalServices;

    return rates
      .filter((r) => r.currency.toUpperCase() === checkoutCurrency.toUpperCase())
      .filter((r) => {
        if (!serviceAllowlist || serviceAllowlist.length === 0) return true;
        const token = r.servicelevel.token.toLowerCase();

        return serviceAllowlist.some((allowed) => token === allowed.toLowerCase());
      })
      .map((r) => ({
        id: `shippo-${r.object_id}`,
        name: r.servicelevel.name,
        amount: config.applyMarkup(r.amount),
        currency: r.currency.toUpperCase(),
        maximum_delivery_days: r.estimated_days ?? undefined,
        minimum_delivery_days: r.estimated_days ?? undefined,
      }));
  }
}
