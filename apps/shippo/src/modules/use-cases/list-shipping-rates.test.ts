import { ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { ShippingCategoryRule } from "@/modules/app-config/domain/shipping-category-rule";
import {
  ShippoAppConfig,
  shippoAppConfigSchema,
} from "@/modules/app-config/domain/shippo-app-config";
import { AppConfigRepoMemory } from "@/modules/app-config/repositories/app-config-repo-memory";
import { createSaleorApiUrl, SaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { ShippoClient } from "@/modules/shippo/shippo-client";

import { ListShippingRatesUseCase, mergeBuckets } from "./list-shipping-rates";
import { InMemoryRateCache } from "./rate-cache";

const SALEOR_URL: SaleorApiUrl = createSaleorApiUrl(
  "https://example.test/graphql/",
)._unsafeUnwrap();
const APP_ID = "app-test";
const CHANNEL = "default-channel";

const SHIPPING_ADDRESS_US = {
  firstName: "Buyer",
  lastName: "Person",
  streetAddress1: "1 Main St",
  city: "Los Angeles",
  postalCode: "90001",
  countryArea: "CA",
  countryCode: "US",
};

const SHIPPING_ADDRESS_CA = {
  ...SHIPPING_ADDRESS_US,
  city: "Toronto",
  postalCode: "M5V2T6",
  countryCode: "CA",
};

const baseConfigInput = {
  id: "cfg",
  name: "Default",
  shippoApiToken: "tok",
  originAddress: {
    name: "Shop",
    street1: "1 Origin Ave",
    city: "Anaheim",
    state: "CA",
    postalCode: "92805",
    country: "US",
  },
  packageDefaults: { weightOunces: 4, lengthInches: 8, widthInches: 6, heightInches: 2 },
};

function makeConfig(): ShippoAppConfig {
  const parsed = shippoAppConfigSchema.parse(baseConfigInput);

  return ShippoAppConfig.create(parsed)._unsafeUnwrap();
}

const clipOnRule = ShippingCategoryRule.create({
  categorySlug: "clip-on",
  displayName: "Clip-on sunglasses",
  freeShipping: false,
  weightOzPerUnit: 4,
  parcel: { lengthIn: 7, widthIn: 10, heightIn: 1 },
  domesticMethods: [
    {
      serviceToken: "usps_first_class",
      mode: "fixed",
      fixedAmount: 5.88,
      minTransitDays: 1,
      maxTransitDays: 5,
    },
    {
      serviceToken: "usps_priority",
      mode: "fixed",
      fixedAmount: 9.88,
      minTransitDays: 1,
      maxTransitDays: 3,
    },
  ],
  internationalMethods: [],
})._unsafeUnwrap();

const bridgeRule = ShippingCategoryRule.create({
  categorySlug: "bridge",
  displayName: "Bridge bar",
  freeShipping: false,
  weightOzPerUnit: 1,
  parcel: { lengthIn: 4, widthIn: 4, heightIn: 1 },
  domesticMethods: [
    {
      serviceToken: "usps_first_class",
      mode: "fixed",
      fixedAmount: 5.88,
      minTransitDays: 1,
      maxTransitDays: 5,
    },
  ],
  internationalMethods: [],
})._unsafeUnwrap();

const partsRule = ShippingCategoryRule.create({
  categorySlug: "parts",
  displayName: "Replacement parts",
  freeShipping: true,
  weightOzPerUnit: 0,
})._unsafeUnwrap();

async function setupRepo(rules: ShippingCategoryRule[]) {
  const repo = new AppConfigRepoMemory();

  await repo.saveConfig({
    config: makeConfig(),
    saleorApiUrl: SALEOR_URL,
    appId: APP_ID,
  });
  await repo.updateChannelMapping(
    { saleorApiUrl: SALEOR_URL, appId: APP_ID },
    { channelSlug: CHANNEL, configId: "cfg" },
  );
  for (const r of rules) {
    await repo.upsertCategoryRule({
      rule: r,
      saleorApiUrl: SALEOR_URL,
      appId: APP_ID,
    });
  }

  return repo;
}

function makeUseCase(rules: ShippingCategoryRule[], shippoStub?: Partial<ShippoClient>) {
  const repoPromise = setupRepo(rules);
  const cache = new InMemoryRateCache();

  return repoPromise.then(
    (repo) =>
      new ListShippingRatesUseCase({
        configRepo: repo,
        rateCache: cache,
        buildShippoClient: () =>
          ({
            getRates: async () => ok({ rates: [], status: "QUEUED", messages: [] }),
            ...shippoStub,
          }) as unknown as ShippoClient,
      }),
  );
}

describe("mergeBuckets", () => {
  it("returns Free shipping when all buckets are free", () => {
    const out = mergeBuckets([{ kind: "free" }, { kind: "free" }]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "Free shipping", amount: 0 });
  });

  it("returns the bucket's methods directly when only one non-free bucket exists", () => {
    const out = mergeBuckets([
      {
        kind: "methods",
        methods: [
          {
            serviceToken: "usps_first_class",
            name: "USPS First Class",
            amount: 5.88,
            currency: "USD",
            minDays: 1,
            maxDays: 5,
          },
        ],
      },
    ]);

    expect(out).toEqual([
      {
        serviceToken: "usps_first_class",
        name: "USPS First Class",
        amount: 5.88,
        currency: "USD",
        minDays: 1,
        maxDays: 5,
      },
    ]);
  });

  it("intersects methods across non-free buckets and takes the max price", () => {
    // Clip-on (FC $5.88, Priority $9.88) + Bridge (FC $5.88).
    const out = mergeBuckets([
      {
        kind: "methods",
        methods: [
          {
            serviceToken: "usps_first_class",
            name: "First Class",
            amount: 5.88,
            currency: "USD",
            minDays: 1,
            maxDays: 5,
          },
          {
            serviceToken: "usps_priority",
            name: "Priority",
            amount: 9.88,
            currency: "USD",
            minDays: 1,
            maxDays: 3,
          },
        ],
      },
      {
        kind: "methods",
        methods: [
          {
            serviceToken: "usps_first_class",
            name: "First Class",
            amount: 5.88,
            currency: "USD",
            minDays: 1,
            maxDays: 5,
          },
        ],
      },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ serviceToken: "usps_first_class", amount: 5.88 });
  });

  it("free bucket does not restrict the intersection", () => {
    const out = mergeBuckets([
      {
        kind: "methods",
        methods: [
          {
            serviceToken: "usps_priority",
            name: "Priority",
            amount: 9.88,
            currency: "USD",
            minDays: 1,
            maxDays: 3,
          },
        ],
      },
      { kind: "free" },
    ]);

    expect(out).toEqual([
      expect.objectContaining({ serviceToken: "usps_priority", amount: 9.88 }),
    ]);
  });
});

describe("ListShippingRatesUseCase", () => {
  it("returns clip-on domestic fixed methods with manufacturing lead time applied", async () => {
    const useCase = await makeUseCase([clipOnRule]);

    const result = await useCase.execute({
      saleorApiUrl: SALEOR_URL,
      appId: APP_ID,
      channelSlug: CHANNEL,
      shippingAddress: SHIPPING_ADDRESS_US,
      lines: [{ quantity: 2, categorySlug: "clip-on" }],
      totalWeightOunces: 8,
    });

    const items = result._unsafeUnwrap();

    // Two fixed methods, names sourced from the service tokens.
    expect(items.map((i) => i.id).sort()).toEqual([
      "method-usps_first_class",
      "method-usps_priority",
    ]);
    const fc = items.find((i) => i.id === "method-usps_first_class")!;
    const pri = items.find((i) => i.id === "method-usps_priority")!;

    expect(fc.amount).toBe(5.88);
    expect(pri.amount).toBe(9.88);
    // Lead-time stamped on: clip-on FC minDays(1) + lead.min(1)=2, max(5)+lead.max(2)=7.
    expect(fc.minimum_delivery_days).toBe(2);
    expect(fc.maximum_delivery_days).toBe(7);
  });

  it("returns single Free shipping method for a parts-only cart", async () => {
    const useCase = await makeUseCase([partsRule]);

    const result = await useCase.execute({
      saleorApiUrl: SALEOR_URL,
      appId: APP_ID,
      channelSlug: CHANNEL,
      shippingAddress: SHIPPING_ADDRESS_US,
      lines: [{ quantity: 3, categorySlug: "parts" }],
      totalWeightOunces: 1,
    });

    const items = result._unsafeUnwrap();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "method-free", amount: 0, name: "Free shipping" });
  });

  it("mixed clip-on + bridge cart shows only the shared method (First Class) at the max price", async () => {
    const useCase = await makeUseCase([clipOnRule, bridgeRule]);

    const result = await useCase.execute({
      saleorApiUrl: SALEOR_URL,
      appId: APP_ID,
      channelSlug: CHANNEL,
      shippingAddress: SHIPPING_ADDRESS_US,
      lines: [
        { quantity: 1, categorySlug: "clip-on" },
        { quantity: 1, categorySlug: "bridge" },
      ],
      totalWeightOunces: 5,
    });

    const items = result._unsafeUnwrap();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "method-usps_first_class", amount: 5.88 });
  });

  it("mixed clip-on + parts keeps clip-on's full method set; parts contribute $0", async () => {
    const useCase = await makeUseCase([clipOnRule, partsRule]);

    const result = await useCase.execute({
      saleorApiUrl: SALEOR_URL,
      appId: APP_ID,
      channelSlug: CHANNEL,
      shippingAddress: SHIPPING_ADDRESS_US,
      lines: [
        { quantity: 1, categorySlug: "clip-on" },
        { quantity: 2, categorySlug: "parts" },
      ],
      totalWeightOunces: 4,
    });

    const items = result._unsafeUnwrap();

    expect(items.map((i) => i.id).sort()).toEqual([
      "method-usps_first_class",
      "method-usps_priority",
    ]);
  });

  it("bridge-only international cart yields no methods (bucket has no intl methods)", async () => {
    const useCase = await makeUseCase([bridgeRule]);

    const result = await useCase.execute({
      saleorApiUrl: SALEOR_URL,
      appId: APP_ID,
      channelSlug: CHANNEL,
      shippingAddress: SHIPPING_ADDRESS_CA,
      lines: [{ quantity: 1, categorySlug: "bridge" }],
      totalWeightOunces: 1,
    });

    const items = result._unsafeUnwrap();

    expect(items).toEqual([]);
  });

  it("falls back to legacy whole-cart Shippo path for products without a category rule", async () => {
    const getRatesSpy = vi.fn(async () =>
      ok({
        rates: [
          {
            object_id: "rate-1",
            provider: "USPS",
            servicelevel: { name: "Priority Mail", token: "usps_priority" },
            amount: 7.5,
            currency: "USD",
            estimated_days: 3,
          },
        ],
        status: "SUCCESS",
        messages: [],
      }),
    );

    const repo = await setupRepo([]);
    const useCase = new ListShippingRatesUseCase({
      configRepo: repo,
      rateCache: new InMemoryRateCache(),
      buildShippoClient: () =>
        ({ getRates: getRatesSpy }) as unknown as ShippoClient,
    });

    const result = await useCase.execute({
      saleorApiUrl: SALEOR_URL,
      appId: APP_ID,
      channelSlug: CHANNEL,
      shippingAddress: SHIPPING_ADDRESS_US,
      lines: [{ quantity: 1, categorySlug: null }],
      totalWeightOunces: 4,
    });

    const items = result._unsafeUnwrap();

    expect(getRatesSpy).toHaveBeenCalledOnce();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Priority Mail");
    expect(items[0].amount).toBe(7.5);
  });
});
