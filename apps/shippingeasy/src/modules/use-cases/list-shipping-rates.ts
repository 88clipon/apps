import { err, ok, Result } from "neverthrow";

import { createLogger } from "@/lib/logger";
import { ShippingEasyConfig } from "@/modules/app-config/domain/shippingeasy-config";
import { AppConfigRepo } from "@/modules/app-config/repositories/app-config-repo";
import { SaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { ShippingEasyClient } from "@/modules/shippingeasy/shippingeasy-client";
import { ShippingEasyApiError } from "@/modules/shippingeasy/shippingeasy-errors";

import { bucketWeight, RateCache } from "./rate-cache";

const logger = createLogger("ListShippingRates");

/** Hard checkout-time budget. */
const DEFAULT_TIMEOUT_MS = 3_000;
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
      buildClient: (config: ShippingEasyConfig) => ShippingEasyClient;
      timeoutMs?: number;
    },
  ) {}

  async execute(
    input: ListShippingRatesInput,
  ): Promise<Result<SaleorShippingMethodResponseItem[], { code: ListShippingRatesErrorCode; message: string }>> {
    if (!input.shippingAddress) {
      return ok([]);
    }

    const configResult = await this.deps.configRepo.getConfigByChannel({
      saleorApiUrl: input.saleorApiUrl,
      appId: input.appId,
      channelSlug: input.channelSlug,
    });

    if (configResult.isErr()) {
      return err({ code: ListShippingRatesError.ConfigError, message: configResult.error.message });
    }

    const config = configResult.value;

    if (!config) {
      return err({ code: ListShippingRatesError.NotConfigured, message: "No config for channel" });
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
      logger.debug("Rate cache hit", {
        channelSlug: input.channelSlug,
        weightBucketOz: weightBucket,
      });

      return ok(
        this.toSaleorShape({
          rates: cached.rates,
          config,
          checkoutCurrency: input.checkoutCurrency,
          destinationCountry: input.shippingAddress.countryCode,
        }),
      );
    }

    const client = this.deps.buildClient(config);
    const result = await client.getRates(
      {
        toAddress: {
          first_name: input.shippingAddress.firstName ?? "",
          last_name: input.shippingAddress.lastName ?? "",
          company: input.shippingAddress.companyName ?? "",
          street1: input.shippingAddress.streetAddress1,
          street2: input.shippingAddress.streetAddress2 ?? "",
          city: input.shippingAddress.city,
          state: input.shippingAddress.countryArea ?? "",
          postal_code: input.shippingAddress.postalCode,
          country: input.shippingAddress.countryCode,
          phone: input.shippingAddress.phone ?? "",
        },
        fromAddress: {
          first_name: config.originAddress.name,
          company: config.originAddress.company ?? "",
          street1: config.originAddress.street1,
          street2: config.originAddress.street2 ?? "",
          city: config.originAddress.city,
          state: config.originAddress.state,
          postal_code: config.originAddress.postalCode,
          country: config.originAddress.country,
          phone: config.originAddress.phone ?? "",
        },
        package: {
          weightOunces: Math.max(weightBucket, config.packageDefaults.weightOunces),
          lengthInches: config.packageDefaults.lengthInches,
          widthInches: config.packageDefaults.widthInches,
          heightInches: config.packageDefaults.heightInches,
        },
        carriers: config.enabledCarriers,
      },
      { timeoutMs: this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    );

    if (result.isErr()) {
      if (
        result.error._internalName === "ShippingEasyApiError.Timeout" ||
        result.error._internalName === "ShippingEasyApiError.NetworkError" ||
        result.error._internalName === "ShippingEasyApiError.ServerError"
      ) {
        logger.warn("ShippingEasy rates call failed; returning empty list", {
          error: result.error.message,
        });

        return ok([]);
      }

      return err({
        code: ListShippingRatesError.UpstreamError,
        message: result.error.message,
      });
    }

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
    rates: readonly import("@/modules/shippingeasy/shippingeasy-schemas").ShippingEasyRate[];
    config: ShippingEasyConfig;
    checkoutCurrency: string;
    destinationCountry: string;
  }): SaleorShippingMethodResponseItem[] {
    const isDomestic =
      destinationCountry.toUpperCase() === config.originAddress.country.toUpperCase();
    const serviceAllowlist = isDomestic
      ? config.domesticServices
      : config.internationalServices;

    return rates
      .filter((r) => r.currency.toUpperCase() === checkoutCurrency.toUpperCase())
      .filter((r) => {
        if (!serviceAllowlist || serviceAllowlist.length === 0) return true;
        const svc = r.service.toLowerCase();

        return serviceAllowlist.some((allowed) => svc === allowed.toLowerCase());
      })
      .map((r) => ({
        id: `${r.carrier}-${r.service}`,
        name: r.service_description ?? `${r.carrier.toUpperCase()} ${r.service}`,
        amount: config.applyMarkup(r.rate),
        currency: r.currency.toUpperCase(),
        maximum_delivery_days: r.estimated_delivery_days_max ?? undefined,
        minimum_delivery_days: r.estimated_delivery_days_min ?? undefined,
      }));
  }
}

/**
 * Suppress unused imports; only needed so TypeScript keeps the reference for
 * the type-level import used above.
 */
 
const _keepShippingEasyApiErrorRef = ShippingEasyApiError;
