import { err, ok, Result } from "neverthrow";

import { createLogger } from "@/lib/logger";
import { ShippingCategoryRule } from "@/modules/app-config/domain/shipping-category-rule";
import { ShippoAppConfig } from "@/modules/app-config/domain/shippo-app-config";
import { AppConfigRepo } from "@/modules/app-config/repositories/app-config-repo";
import { SaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { ShippoClient, ShippoRate } from "@/modules/shippo/shippo-client";

import { bucketWeight, RateCache } from "./rate-cache";

const logger = createLogger("ListShippingRates");

const CHECKOUT_SHIPPING_CURRENCY = "USD";
/** Sentinel slug used for cart lines without a Saleor category. */
const UNMAPPED_BUCKET = "_unmapped";

/**
 * Merchant policy: returned shipping method prices are always in USD (dollars),
 * using Shippo's USD line (`amount` + currency USD, or `amount_local` when local is USD).
 */
function pickUsdPriceForCheckout(rate: ShippoRate): { amount: number; currency: string } | null {
  const usd = CHECKOUT_SHIPPING_CURRENCY;

  if (rate.currency.toUpperCase() === usd) {
    return { amount: rate.amount, currency: usd };
  }

  if (
    rate.currency_local &&
    rate.amount_local != null &&
    rate.currency_local.toUpperCase() === usd
  ) {
    return { amount: rate.amount_local, currency: usd };
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

export type CartLine = {
  quantity: number;
  /** Saleor product category slug, or null if the product has no category. */
  categorySlug: string | null;
};

export type ListShippingRatesInput = {
  saleorApiUrl: SaleorApiUrl;
  appId: string;
  channelSlug: string;
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
  /**
   * Cart lines grouped by Saleor category slug. The use case re-groups these
   * into buckets to apply per-category rules. When this list is empty (e.g.
   * legacy callers), the use case falls back to the global packageDefaults
   * path using `totalWeightOunces` only.
   */
  lines: CartLine[];
  /** Total cart weight in ounces — used as a fallback for the legacy path. */
  totalWeightOunces: number;
};

export const ListShippingRatesError = {
  NotConfigured: "NOT_CONFIGURED",
  ConfigError: "CONFIG_ERROR",
  UpstreamError: "UPSTREAM_ERROR",
} as const;

export type ListShippingRatesErrorCode =
  (typeof ListShippingRatesError)[keyof typeof ListShippingRatesError];

/** Per-bucket method record before merge. */
type BucketMethod = {
  serviceToken: string;
  name: string;
  amount: number;
  currency: string;
  minDays: number;
  maxDays: number;
};

type BucketResult =
  | { kind: "free" }
  /** Bucket actively contributes methods to the intersection. */
  | { kind: "methods"; methods: BucketMethod[] };

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
  ): Promise<
    Result<
      SaleorShippingMethodResponseItem[],
      { code: ListShippingRatesErrorCode; message: string }
    >
  > {
    logger.info("execute called", {
      channel: input.channelSlug,
      country: input.shippingAddress?.countryCode,
      postalCode: input.shippingAddress?.postalCode,
      lineCount: input.lines.length,
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

      return err({
        code: ListShippingRatesError.ConfigError,
        message: configResult.error.message,
      });
    }

    const config = configResult.value;

    if (!config) {
      logger.warn("No config for channel", { channel: input.channelSlug });

      return err({
        code: ListShippingRatesError.NotConfigured,
        message: "No config for channel",
      });
    }

    const rootResult = await this.deps.configRepo.getRootConfig({
      saleorApiUrl: input.saleorApiUrl,
      appId: input.appId,
    });

    if (rootResult.isErr()) {
      logger.warn("Root config error", { message: rootResult.error.message });

      return err({
        code: ListShippingRatesError.ConfigError,
        message: rootResult.error.message,
      });
    }
    const rules = rootResult.value.categoryRules;

    const isDomestic =
      input.shippingAddress.countryCode.toUpperCase() ===
      config.originAddress.country.toUpperCase();
    const zone: "domestic" | "international" = isDomestic ? "domestic" : "international";

    // Group lines by category slug (lines with no category → _unmapped).
    const buckets = new Map<string, number>(); // slug -> totalQty

    for (const line of input.lines) {
      const slug = line.categorySlug ?? UNMAPPED_BUCKET;

      buckets.set(slug, (buckets.get(slug) ?? 0) + line.quantity);
    }

    // Fallback for legacy callers that didn't pass any lines.
    if (buckets.size === 0) {
      buckets.set(UNMAPPED_BUCKET, 0);
    }

    const bucketResults: BucketResult[] = [];

    for (const [slug, qty] of buckets) {
      const rule = slug === UNMAPPED_BUCKET ? null : rules.get(slug) ?? null;

      if (rule) {
        const r = await this.resolveRuleBucket({
          rule,
          qty,
          zone,
          input,
          config,
        });

        if (r.isErr()) return err(r.error);
        bucketResults.push(r.value);
      } else {
        // No matching rule — fall back to the legacy whole-cart Shippo call.
        const r = await this.resolveLegacyBucket({ input, config });

        if (r.isErr()) return err(r.error);
        bucketResults.push(r.value);
      }
    }

    const merged = mergeBuckets(bucketResults);

    // Add the store-wide manufacturing lead time to every method.
    const lead = config.manufacturingLeadTimeDays;
    const stamped = merged.map((m) => ({
      ...m,
      minDays: m.minDays + lead.min,
      maxDays: m.maxDays + lead.max,
    }));

    // Apply markup last so per-bucket prices stay raw / comparable.
    const items: SaleorShippingMethodResponseItem[] = stamped.map((m) => ({
      id: `method-${m.serviceToken}`,
      name: m.name,
      amount: m.amount === 0 ? 0 : config.applyMarkup(m.amount),
      currency: m.currency,
      minimum_delivery_days: m.minDays > 0 ? m.minDays : undefined,
      maximum_delivery_days: m.maxDays > 0 ? m.maxDays : undefined,
    }));

    logger.info("Returning merged shipping methods", {
      count: items.length,
      methods: items.map((i) => `${i.name}=${i.amount}${i.currency}`),
    });

    return ok(items);
  }

  /** Resolve a bucket whose category has an explicit rule. */
  private async resolveRuleBucket(args: {
    rule: ShippingCategoryRule;
    qty: number;
    zone: "domestic" | "international";
    input: ListShippingRatesInput;
    config: ShippoAppConfig;
  }): Promise<
    Result<BucketResult, { code: ListShippingRatesErrorCode; message: string }>
  > {
    const { rule, qty, zone, input, config } = args;

    if (rule.freeShipping) {
      return ok({ kind: "free" });
    }

    const methodDefs = rule.methodsFor(zone);

    if (methodDefs.length === 0) {
      /*
       * Non-free rule with no methods for this zone — the bucket can't ship
       * to this destination. Empty method set kills the intersection.
       */
      return ok({ kind: "methods", methods: [] });
    }

    // Live methods need one Shippo call per bucket; fixed methods don't.
    const liveTokens = methodDefs
      .filter((m) => m.mode === "live")
      .map((m) => m.serviceToken);
    let liveRates: readonly ShippoRate[] = [];

    if (liveTokens.length > 0 && rule.parcel) {
      const ratesResult = await this.fetchShippoRatesForBucket({
        input,
        config,
        weightOunces: rule.weightOzPerUnit * qty,
        parcel: rule.parcel,
        bucketSignature: `cat:${rule.categorySlug}`,
      });

      if (ratesResult.isErr()) return err(ratesResult.error);
      liveRates = ratesResult.value;
    }

    const methods: BucketMethod[] = [];

    for (const def of methodDefs) {
      if (def.mode === "fixed") {
        if (def.fixedAmount === undefined) continue;
        methods.push({
          serviceToken: def.serviceToken,
          name: prettyMethodName(def.serviceToken),
          amount: def.fixedAmount,
          currency: CHECKOUT_SHIPPING_CURRENCY,
          minDays: def.minTransitDays,
          maxDays: def.maxTransitDays,
        });
        continue;
      }

      // mode === "live"
      const match = liveRates.find(
        (r) => r.servicelevel.token.toLowerCase() === def.serviceToken.toLowerCase(),
      );

      if (!match) {
        logger.debug("Live method not returned by Shippo for bucket", {
          category: rule.categorySlug,
          serviceToken: def.serviceToken,
        });
        continue;
      }
      const picked = pickUsdPriceForCheckout(match);

      if (!picked) continue;
      methods.push({
        serviceToken: def.serviceToken,
        name: match.servicelevel.name || prettyMethodName(def.serviceToken),
        amount: picked.amount,
        currency: picked.currency,
        minDays: def.minTransitDays,
        maxDays: def.maxTransitDays,
      });
    }

    return ok({ kind: "methods", methods });
  }

  /** Legacy whole-cart path for buckets without a category rule. */
  private async resolveLegacyBucket(args: {
    input: ListShippingRatesInput;
    config: ShippoAppConfig;
  }): Promise<
    Result<BucketResult, { code: ListShippingRatesErrorCode; message: string }>
  > {
    const { input, config } = args;
    const ratesResult = await this.fetchShippoRatesForBucket({
      input,
      config,
      weightOunces: input.totalWeightOunces,
      parcel: {
        lengthIn: config.packageDefaults.lengthInches,
        widthIn: config.packageDefaults.widthInches,
        heightIn: config.packageDefaults.heightInches,
      },
      bucketSignature: "legacy",
    });

    if (ratesResult.isErr()) return err(ratesResult.error);

    const isDomestic =
      input.shippingAddress!.countryCode.toUpperCase() ===
      config.originAddress.country.toUpperCase();
    const serviceAllowlist = isDomestic
      ? config.domesticServices
      : config.internationalServices;

    const methods: BucketMethod[] = ratesResult.value
      .map((r) => {
        const picked = pickUsdPriceForCheckout(r);

        if (!picked) return null;
        if (serviceAllowlist.length > 0) {
          const allowed = serviceAllowlist.some(
            (a) => a.toLowerCase() === r.servicelevel.token.toLowerCase(),
          );

          if (!allowed) return null;
        }

        return {
          serviceToken: r.servicelevel.token,
          name: r.servicelevel.name,
          amount: picked.amount,
          currency: picked.currency,
          minDays: r.estimated_days ?? 0,
          maxDays: r.estimated_days ?? 0,
        } satisfies BucketMethod;
      })
      .filter((m): m is BucketMethod => m != null);

    return ok({ kind: "methods", methods });
  }

  /** Common Shippo call for a single bucket parcel. */
  private async fetchShippoRatesForBucket(args: {
    input: ListShippingRatesInput;
    config: ShippoAppConfig;
    weightOunces: number;
    parcel: { lengthIn?: number; widthIn?: number; heightIn?: number };
    bucketSignature: string;
  }): Promise<
    Result<readonly ShippoRate[], { code: ListShippingRatesErrorCode; message: string }>
  > {
    const { input, config } = args;
    const client = this.deps.buildShippoClient(config);

    if (!client) {
      logger.warn(
        "No Shippo API token configured; cannot fetch live rates for bucket",
        { bucket: args.bucketSignature },
      );

      return ok([]);
    }

    const weightBucketOz = bucketWeight(args.weightOunces);
    const cacheKey = {
      saleorApiUrl: input.saleorApiUrl,
      appId: input.appId,
      channelSlug: input.channelSlug,
      country: input.shippingAddress!.countryCode,
      postalCode: input.shippingAddress!.postalCode,
      weightBucketOz,
      bucketSignature: args.bucketSignature,
    };
    const cached = await this.deps.rateCache.get(cacheKey);

    if (cached) {
      logger.debug("Rate cache hit", { bucket: args.bucketSignature });

      return ok(cached.rates);
    }

    const fetched = await client.getRates(
      {
        toAddress: {
          name: `${input.shippingAddress!.firstName ?? ""} ${input.shippingAddress!.lastName ?? ""}`.trim(),
          company: input.shippingAddress!.companyName,
          street1: input.shippingAddress!.streetAddress1,
          street2: input.shippingAddress!.streetAddress2,
          city: input.shippingAddress!.city,
          state: input.shippingAddress!.countryArea,
          zip: input.shippingAddress!.postalCode,
          country: input.shippingAddress!.countryCode,
          phone: input.shippingAddress!.phone,
        },
        fromAddress: {
          name: config.originAddress.name,
          company: config.originAddress.company,
          street1: config.originAddress.street1,
          street2: config.originAddress.street2,
          city: config.originAddress.city,
          state: config.originAddress.state,
          zip: config.originAddress.postalCode,
          country: config.originAddress.country,
          phone: config.originAddress.phone,
        },
        parcel: {
          weightOunces: Math.max(weightBucketOz, config.packageDefaults.weightOunces),
          lengthInches: args.parcel.lengthIn,
          widthInches: args.parcel.widthIn,
          heightInches: args.parcel.heightIn,
        },
      },
      { timeoutMs: this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    );

    if (fetched.isErr()) {
      const errName =
        (fetched.error as { _internalName?: string })._internalName ?? fetched.error.message;

      logger.warn("Shippo API error", {
        bucket: args.bucketSignature,
        errName,
        message: fetched.error.message,
      });

      if (
        errName === "ShippoApiError.Timeout" ||
        errName === "ShippoApiError.NetworkError" ||
        errName === "ShippoApiError.ServerError"
      ) {
        return ok([]);
      }

      return err({
        code: ListShippingRatesError.UpstreamError,
        message: fetched.error.message,
      });
    }

    if (fetched.value.rates.length > 0) {
      await this.deps.rateCache.set(cacheKey, {
        rates: [...fetched.value.rates],
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }

    return ok(fetched.value.rates);
  }
}

/**
 * Combine per-bucket results into the cart's offered shipping methods.
 *
 * Rules:
 *   - "free" buckets contribute $0 to every method and never restrict the
 *     intersection.
 *   - "methods" buckets define the universe: a method is offered only if every
 *     non-free bucket includes it.
 *   - When multiple buckets include the same method, cart price = max across
 *     buckets, delivery window = max-of-mins / max-of-maxes.
 *   - If the cart is entirely free buckets, a single "Free shipping" method is
 *     returned (zero days; lead time is added by the caller).
 */
export function mergeBuckets(results: readonly BucketResult[]): BucketMethod[] {
  if (results.length === 0) return [];

  const restricting = results.filter(
    (r): r is { kind: "methods"; methods: BucketMethod[] } => r.kind === "methods",
  );

  if (restricting.length === 0) {
    return [
      {
        serviceToken: "free",
        name: "Free shipping",
        amount: 0,
        currency: CHECKOUT_SHIPPING_CURRENCY,
        minDays: 0,
        maxDays: 0,
      },
    ];
  }

  // Intersection of service tokens across non-free buckets.
  let tokenSet: Set<string> | null = null;

  for (const r of restricting) {
    const ts = new Set(r.methods.map((m) => m.serviceToken.toLowerCase()));

    if (tokenSet === null) {
      tokenSet = ts;
    } else {
      for (const t of [...tokenSet]) {
        if (!ts.has(t)) tokenSet.delete(t);
      }
    }
  }

  if (!tokenSet || tokenSet.size === 0) return [];

  const merged: BucketMethod[] = [];

  for (const token of tokenSet) {
    const perBucket: BucketMethod[] = restricting
      .map(
        (r) =>
          r.methods.find((m) => m.serviceToken.toLowerCase() === token) ?? null,
      )
      .filter((m): m is BucketMethod => m != null);

    if (perBucket.length === 0) continue;

    merged.push({
      serviceToken: perBucket[0].serviceToken,
      name: perBucket[0].name,
      amount: perBucket.reduce((a, m) => Math.max(a, m.amount), 0),
      currency: perBucket[0].currency,
      minDays: perBucket.reduce((a, m) => Math.max(a, m.minDays), 0),
      maxDays: perBucket.reduce((a, m) => Math.max(a, m.maxDays), 0),
    });
  }

  return merged;
}

/** Best-effort human name from a Shippo-style service token. */
function prettyMethodName(token: string): string {
  return token
    .replace(/^usps_/, "USPS ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
