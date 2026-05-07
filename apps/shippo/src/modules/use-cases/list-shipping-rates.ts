import { err, ok, Result } from "neverthrow";

import { createLogger } from "@/lib/logger";
import { ShippoAppConfig } from "@/modules/app-config/domain/shippo-app-config";
import { AppConfigRepo } from "@/modules/app-config/repositories/app-config-repo";
import { SaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { ShippoClient, ShippoRate } from "@/modules/shippo/shippo-client";

import { bucketWeight, RateCache } from "./rate-cache";

const logger = createLogger("ListShippingRates");

/** Pick a Shippo rate line item in the checkout (channel) currency for Saleor validation. */
function pickPriceForCheckout(
  rate: ShippoRate,
  checkoutCurrency: string,
): { amount: number; currency: string } | null {
  const target = checkoutCurrency.toUpperCase();

  if (rate.currency.toUpperCase() === target) {
    return { amount: rate.amount, currency: target };
  }

  if (
    rate.currency_local &&
    rate.amount_local != null &&
    rate.currency_local.toUpperCase() === target
  ) {
    return { amount: rate.amount_local, currency: target };
  }

  return null;
}

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
      buildShippoClient: (config: ShippoAppConfig) => ShippoClient | null;
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
      logger.warn(
        "No Shippo API token configured; set the Shippo API token in app settings (or SHIPPO_API_TOKEN) to enable real-time rates",
      );

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
      shipmentStatus: result.value.status,
      shipmentMessages: result.value.messages,
      rates: result.value.rates.map((r) => {
        const picked = pickPriceForCheckout(r, input.checkoutCurrency);

        return `${r.provider}/${r.servicelevel.token}=${picked ? `${picked.amount}${picked.currency}` : `unpriced(${r.currency}/${r.currency_local ?? "?"})`}`;
      }),
    });

    if (result.value.rates.length === 0) {
      const isDomesticDest =
        input.shippingAddress.countryCode.toUpperCase() === config.originAddress.country.toUpperCase();

      logger.warn("Shippo returned 0 rates", {
        isDomestic: isDomesticDest,
        destinationCountry: input.shippingAddress.countryCode,
        postalCode: input.shippingAddress.postalCode,
        shipmentStatus: result.value.status,
        shipmentMessages: result.value.messages,
        weightOunces: weightBucket,
        hint: isDomesticDest
          ? "Check Shippo carrier accounts and origin address."
          : "Most likely no international carrier accounts (UPS Worldwide / FedEx Intl / DHL Express) are enabled in Shippo, or the address requires customs declarations.",
      });
    } else {
      await this.deps.rateCache.set(cacheKey, {
        rates: [...result.value.rates],
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }

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
    config: ShippoAppConfig;
    checkoutCurrency: string;
    destinationCountry: string;
  }): SaleorShippingMethodResponseItem[] {
    const isDomestic =
      destinationCountry.toUpperCase() === config.originAddress.country.toUpperCase();
    const serviceAllowlist = isDomestic ? config.domesticServices : config.internationalServices;

    const priced = rates
      .map((r) => {
        const picked = pickPriceForCheckout(r, checkoutCurrency);

        return picked ? { rate: r, ...picked } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    if (priced.length === 0 && rates.length > 0) {
      logger.warn("All Shippo rates dropped: no price matched checkout currency", {
        checkoutCurrency,
        sample: rates.slice(0, 5).map((r) => ({
          provider: r.provider,
          token: r.servicelevel.token,
          currency: r.currency,
          currency_local: r.currency_local,
        })),
      });
    }

    const applyAllowlist = priced.filter(({ rate: r }) => {
      if (!serviceAllowlist || serviceAllowlist.length === 0) return true;
      const token = r.servicelevel.token.toLowerCase();

      return serviceAllowlist.some((allowed) => token === allowed.toLowerCase());
    });

    let afterAllowlist = applyAllowlist;

    if (
      applyAllowlist.length === 0 &&
      priced.length > 0 &&
      serviceAllowlist &&
      serviceAllowlist.length > 0
    ) {
      logger.warn(
        "Service allowlist excluded all priced Shippo rates; returning all rates that matched checkout currency",
        {
          isDomestic,
          destinationCountry,
          allowlist: [...serviceAllowlist],
        },
      );
      afterAllowlist = priced;
    }

    return afterAllowlist.map(({ rate: r, amount, currency }) => ({
      id: `shippo-${r.object_id}`,
      name: r.servicelevel.name,
      amount: config.applyMarkup(amount),
      currency,
      maximum_delivery_days: r.estimated_days ?? undefined,
      minimum_delivery_days: r.estimated_days ?? undefined,
    }));
  }
}
