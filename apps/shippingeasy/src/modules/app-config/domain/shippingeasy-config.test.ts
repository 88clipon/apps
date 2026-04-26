import { describe, expect, it } from "vitest";

import { ShippingEasyConfig } from "./shippingeasy-config";

const validInput = {
  id: "cfg-1",
  name: "Default",
  apiKey: "key",
  apiSecret: "secret",
  storeId: "42",
  originAddress: {
    name: "88clipon",
    company: "",
    street1: "1 Test St",
    street2: "",
    city: "Tampa",
    state: "FL",
    postalCode: "33601",
    country: "US",
    phone: "",
    email: "",
  },
  packageDefaults: { weightOunces: 6 },
  enabledCarriers: ["usps" as const, "ups" as const],
  rateMarkup: { type: "percent" as const, value: 10 },
  emailsHandledBy: "shippingeasy" as const,
};

describe("ShippingEasyConfig", () => {
  it("creates a valid config", () => {
    const r = ShippingEasyConfig.create(validInput);

    expect(r.isOk()).toBe(true);
  });

  it("rejects a config with empty store id", () => {
    const r = ShippingEasyConfig.create({ ...validInput, storeId: "" });

    expect(r.isErr()).toBe(true);
  });

  it("defaults the webhook secret to the api secret when not set", () => {
    const r = ShippingEasyConfig.create(validInput);

    if (r.isErr()) throw r.error;
    expect(r.value.webhookSecret).toBe("secret");
  });

  it("honors an explicit webhook secret", () => {
    const r = ShippingEasyConfig.create({ ...validInput, webhookSecret: "other" });

    if (r.isErr()) throw r.error;
    expect(r.value.webhookSecret).toBe("other");
  });

  it("applies percent markup", () => {
    const r = ShippingEasyConfig.create(validInput);

    if (r.isErr()) throw r.error;
    expect(r.value.applyMarkup(10)).toBe(11);
  });

  it("applies flat markup", () => {
    const r = ShippingEasyConfig.create({
      ...validInput,
      rateMarkup: { type: "flat", value: 2.5 },
    });

    if (r.isErr()) throw r.error;
    expect(r.value.applyMarkup(10)).toBe(12.5);
  });

  it("leaves rate untouched when markup is none", () => {
    const r = ShippingEasyConfig.create({
      ...validInput,
      rateMarkup: { type: "none", value: 0 },
    });

    if (r.isErr()) throw r.error;
    expect(r.value.applyMarkup(7.25)).toBe(7.25);
  });
});
