import { err, ok, Result } from "neverthrow";
import { z } from "zod";

import { BaseError } from "@/lib/errors";

/**
 * Carriers that ShippingEasy can return rates for. The allowlist shrinks
 * rate responses to reduce noise at checkout.
 */
export const shippingEasyCarrierSchema = z.enum([
  "usps",
  "ups",
  "fedex",
  "dhl",
  "dhl_ecommerce",
]);
export type ShippingEasyCarrier = z.infer<typeof shippingEasyCarrierSchema>;

export const originAddressSchema = z.object({
  name: z.string().min(1),
  company: z.string().optional().default(""),
  street1: z.string().min(1),
  street2: z.string().optional().default(""),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().length(2),
  phone: z.string().optional().default(""),
  email: z.string().email().optional().or(z.literal("")).default(""),
});
export type OriginAddress = z.infer<typeof originAddressSchema>;

export const packageDefaultsSchema = z.object({
  weightOunces: z.number().positive(),
  lengthInches: z.number().positive().optional(),
  widthInches: z.number().positive().optional(),
  heightInches: z.number().positive().optional(),
});
export type PackageDefaults = z.infer<typeof packageDefaultsSchema>;

export const rateMarkupSchema = z
  .object({
    type: z.enum(["none", "flat", "percent"]),
    /** Flat USD markup when type === "flat", percent markup (e.g. 10 for +10%) when "percent". */
    value: z.number().min(0).default(0),
  })
  .default({ type: "none", value: 0 });
export type RateMarkup = z.infer<typeof rateMarkupSchema>;

export const emailsHandledBySchema = z.enum(["shippingeasy", "saleor"]).default("shippingeasy");
export type EmailsHandledBy = z.infer<typeof emailsHandledBySchema>;

export const shippingEasyConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  storeId: z.string().min(1),
  /** Used to verify inbound webhooks. Defaults to apiSecret if not provided. */
  webhookSecret: z.string().optional(),
  originAddress: originAddressSchema,
  packageDefaults: packageDefaultsSchema,
  enabledCarriers: z.array(shippingEasyCarrierSchema).default(["usps", "ups"]),
  /** Service-level allowlist for domestic destinations. Empty = all services pass through. */
  domesticServices: z.array(z.string()).optional().default([]),
  /** Service-level allowlist for international destinations. Empty = all services pass through. */
  internationalServices: z.array(z.string()).optional().default([]),
  rateMarkup: rateMarkupSchema,
  emailsHandledBy: emailsHandledBySchema,
});
export type ShippingEasyConfigInput = z.input<typeof shippingEasyConfigSchema>;
export type ShippingEasyConfigFields = z.infer<typeof shippingEasyConfigSchema>;

export const ShippingEasyConfigValidationError = BaseError.subclass(
  "ShippingEasyConfigValidationError",
  { props: { _internalName: "ShippingEasyConfig.ValidationError" as const } },
);

/**
 * Domain class encapsulating a single ShippingEasy configuration.
 * Multiple instances can be saved and mapped to Saleor channels via
 * the AppConfigRepo.
 */
export class ShippingEasyConfig {
  readonly id: string;
  readonly name: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly storeId: string;
  readonly webhookSecret: string;
  readonly originAddress: OriginAddress;
  readonly packageDefaults: PackageDefaults;
  readonly enabledCarriers: readonly ShippingEasyCarrier[];
  readonly domesticServices: readonly string[];
  readonly internationalServices: readonly string[];
  readonly rateMarkup: RateMarkup;
  readonly emailsHandledBy: EmailsHandledBy;

  private constructor(fields: Required<ShippingEasyConfigFields> & { webhookSecret: string }) {
    this.id = fields.id;
    this.name = fields.name;
    this.apiKey = fields.apiKey;
    this.apiSecret = fields.apiSecret;
    this.storeId = fields.storeId;
    this.webhookSecret = fields.webhookSecret;
    this.originAddress = fields.originAddress;
    this.packageDefaults = fields.packageDefaults;
    this.enabledCarriers = fields.enabledCarriers;
    this.domesticServices = fields.domesticServices;
    this.internationalServices = fields.internationalServices;
    this.rateMarkup = fields.rateMarkup;
    this.emailsHandledBy = fields.emailsHandledBy;
  }

  static create(
    input: ShippingEasyConfigInput,
  ): Result<ShippingEasyConfig, InstanceType<typeof ShippingEasyConfigValidationError>> {
    const parsed = shippingEasyConfigSchema.safeParse(input);

    if (!parsed.success) {
      return err(
        new ShippingEasyConfigValidationError("Invalid ShippingEasy config", {
          cause: parsed.error,
        }),
      );
    }

    return ok(
      new ShippingEasyConfig({
        ...parsed.data,
        webhookSecret: parsed.data.webhookSecret ?? parsed.data.apiSecret,
      }),
    );
  }

  applyMarkup(rate: number): number {
    switch (this.rateMarkup.type) {
      case "flat":
        return Math.round((rate + this.rateMarkup.value) * 100) / 100;
      case "percent":
        return Math.round(rate * (1 + this.rateMarkup.value / 100) * 100) / 100;
      default:
        return rate;
    }
  }
}

/**
 * Safe, serializable view for the configuration UI (secrets masked).
 */
export type ShippingEasyFrontendConfigFields = {
  readonly id: string;
  readonly name: string;
  readonly apiKeyMasked: string;
  readonly storeId: string;
  readonly originAddress: OriginAddress;
  readonly packageDefaults: PackageDefaults;
  readonly enabledCarriers: readonly ShippingEasyCarrier[];
  readonly domesticServices: readonly string[];
  readonly internationalServices: readonly string[];
  readonly rateMarkup: RateMarkup;
  readonly emailsHandledBy: EmailsHandledBy;
};

export class ShippingEasyFrontendConfig implements ShippingEasyFrontendConfigFields {
  readonly id: string;
  readonly name: string;
  readonly apiKeyMasked: string;
  readonly storeId: string;
  readonly originAddress: OriginAddress;
  readonly packageDefaults: PackageDefaults;
  readonly enabledCarriers: readonly ShippingEasyCarrier[];
  readonly domesticServices: readonly string[];
  readonly internationalServices: readonly string[];
  readonly rateMarkup: RateMarkup;
  readonly emailsHandledBy: EmailsHandledBy;

  private constructor(fields: ShippingEasyFrontendConfigFields) {
    this.id = fields.id;
    this.name = fields.name;
    this.apiKeyMasked = fields.apiKeyMasked;
    this.storeId = fields.storeId;
    this.originAddress = fields.originAddress;
    this.packageDefaults = fields.packageDefaults;
    this.enabledCarriers = fields.enabledCarriers;
    this.domesticServices = fields.domesticServices;
    this.internationalServices = fields.internationalServices;
    this.rateMarkup = fields.rateMarkup;
    this.emailsHandledBy = fields.emailsHandledBy;
  }

  static fromConfig(c: ShippingEasyConfig): ShippingEasyFrontendConfig {
    return new ShippingEasyFrontendConfig({
      id: c.id,
      name: c.name,
      apiKeyMasked: `...${c.apiKey.slice(-4)}`,
      storeId: c.storeId,
      originAddress: c.originAddress,
      packageDefaults: c.packageDefaults,
      enabledCarriers: c.enabledCarriers,
      domesticServices: c.domesticServices,
      internationalServices: c.internationalServices,
      rateMarkup: c.rateMarkup,
      emailsHandledBy: c.emailsHandledBy,
    });
  }
}
