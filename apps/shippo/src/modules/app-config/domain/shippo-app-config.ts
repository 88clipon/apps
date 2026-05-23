import { err, ok, Result } from "neverthrow";
import { z } from "zod";

import { BaseError } from "@/lib/errors";

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
    /** Flat markup (in checkout currency) when type === "flat", percent (e.g. 10 = +10%) when "percent". */
    value: z.number().min(0).default(0),
  })
  .default({ type: "none", value: 0 });
export type RateMarkup = z.infer<typeof rateMarkupSchema>;

/**
 * Who notifies the customer when a label is purchased and tracking lands.
 * - `shippo`: Shippo / the carrier sends tracking emails; Saleor is told NOT
 *   to notify so customers receive exactly one shipping email.
 * - `saleor`: Saleor sends its native fulfillment notification; the merchant
 *   should disable Shippo's tracking emails to avoid duplicates.
 */
export const emailsHandledBySchema = z.enum(["shippo", "saleor"]).default("saleor");
export type EmailsHandledBy = z.infer<typeof emailsHandledBySchema>;

/**
 * Days added to every shipping method's transit window to account for
 * in-house fulfillment / label printing before the parcel actually leaves.
 */
export const manufacturingLeadTimeSchema = z
  .object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  })
  .default({ min: 1, max: 2 })
  .superRefine((value, ctx) => {
    if (value.max < value.min) {
      ctx.addIssue({
        path: ["max"],
        code: z.ZodIssueCode.custom,
        message: "max must be >= min",
      });
    }
  });
export type ManufacturingLeadTime = z.infer<typeof manufacturingLeadTimeSchema>;

export const shippoAppConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Shippo API token. Required to fetch rates and (optionally) buy labels. */
  shippoApiToken: z.string().min(1),
  /** HMAC secret used to verify inbound Shippo webhooks (configured in Shippo dashboard). */
  webhookSecret: z.string().optional().default(""),
  /** When true, ORDER_CREATED triggers a Shippo Transaction (label purchase). */
  autoPurchaseLabel: z.boolean().optional().default(false),
  /**
   * Shippo label file format. PDF_4x6 fits most thermal printers; PDF/PNG/ZPLII
   * are useful for desktop printers and direct-to-printer workflows.
   */
  labelFileType: z
    .enum(["PDF", "PDF_4x6", "PNG", "ZPLII"])
    .optional()
    .default("PDF_4x6"),
  originAddress: originAddressSchema,
  packageDefaults: packageDefaultsSchema,
  /** Service-level allowlist for domestic destinations. Empty = all services pass through. */
  domesticServices: z.array(z.string()).optional().default([]),
  /** Service-level allowlist for international destinations. Empty = all services pass through. */
  internationalServices: z.array(z.string()).optional().default([]),
  rateMarkup: rateMarkupSchema,
  emailsHandledBy: emailsHandledBySchema,
  manufacturingLeadTimeDays: manufacturingLeadTimeSchema,
});
export type ShippoAppConfigInput = z.input<typeof shippoAppConfigSchema>;
export type ShippoAppConfigFields = z.infer<typeof shippoAppConfigSchema>;

export const ShippoAppConfigValidationError = BaseError.subclass(
  "ShippoAppConfigValidationError",
  { props: { _internalName: "ShippoAppConfig.ValidationError" as const } },
);

/**
 * Domain class encapsulating a single Shippo configuration. Multiple instances
 * can be saved and mapped to Saleor channels via the AppConfigRepo.
 */
export class ShippoAppConfig {
  readonly id: string;
  readonly name: string;
  readonly shippoApiToken: string;
  readonly webhookSecret: string;
  readonly autoPurchaseLabel: boolean;
  readonly labelFileType: ShippoAppConfigFields["labelFileType"];
  readonly originAddress: OriginAddress;
  readonly packageDefaults: PackageDefaults;
  readonly domesticServices: readonly string[];
  readonly internationalServices: readonly string[];
  readonly rateMarkup: RateMarkup;
  readonly emailsHandledBy: EmailsHandledBy;
  readonly manufacturingLeadTimeDays: ManufacturingLeadTime;

  private constructor(fields: Required<ShippoAppConfigFields>) {
    this.id = fields.id;
    this.name = fields.name;
    this.shippoApiToken = fields.shippoApiToken;
    this.webhookSecret = fields.webhookSecret;
    this.autoPurchaseLabel = fields.autoPurchaseLabel;
    this.labelFileType = fields.labelFileType;
    this.originAddress = fields.originAddress;
    this.packageDefaults = fields.packageDefaults;
    this.domesticServices = fields.domesticServices;
    this.internationalServices = fields.internationalServices;
    this.rateMarkup = fields.rateMarkup;
    this.emailsHandledBy = fields.emailsHandledBy;
    this.manufacturingLeadTimeDays = fields.manufacturingLeadTimeDays;
  }

  static create(
    input: ShippoAppConfigInput,
  ): Result<ShippoAppConfig, InstanceType<typeof ShippoAppConfigValidationError>> {
    const parsed = shippoAppConfigSchema.safeParse(input);

    if (!parsed.success) {
      return err(
        new ShippoAppConfigValidationError("Invalid Shippo config", {
          cause: parsed.error,
        }),
      );
    }

    return ok(new ShippoAppConfig(parsed.data));
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
export type ShippoAppFrontendConfigFields = {
  readonly id: string;
  readonly name: string;
  readonly shippoApiTokenMasked: string;
  readonly webhookSecretConfigured: boolean;
  readonly autoPurchaseLabel: boolean;
  readonly labelFileType: ShippoAppConfigFields["labelFileType"];
  readonly originAddress: OriginAddress;
  readonly packageDefaults: PackageDefaults;
  readonly domesticServices: readonly string[];
  readonly internationalServices: readonly string[];
  readonly rateMarkup: RateMarkup;
  readonly emailsHandledBy: EmailsHandledBy;
  readonly manufacturingLeadTimeDays: ManufacturingLeadTime;
};

export class ShippoAppFrontendConfig implements ShippoAppFrontendConfigFields {
  readonly id: string;
  readonly name: string;
  readonly shippoApiTokenMasked: string;
  readonly webhookSecretConfigured: boolean;
  readonly autoPurchaseLabel: boolean;
  readonly labelFileType: ShippoAppConfigFields["labelFileType"];
  readonly originAddress: OriginAddress;
  readonly packageDefaults: PackageDefaults;
  readonly domesticServices: readonly string[];
  readonly internationalServices: readonly string[];
  readonly rateMarkup: RateMarkup;
  readonly emailsHandledBy: EmailsHandledBy;
  readonly manufacturingLeadTimeDays: ManufacturingLeadTime;

  private constructor(fields: ShippoAppFrontendConfigFields) {
    this.id = fields.id;
    this.name = fields.name;
    this.shippoApiTokenMasked = fields.shippoApiTokenMasked;
    this.webhookSecretConfigured = fields.webhookSecretConfigured;
    this.autoPurchaseLabel = fields.autoPurchaseLabel;
    this.labelFileType = fields.labelFileType;
    this.originAddress = fields.originAddress;
    this.packageDefaults = fields.packageDefaults;
    this.domesticServices = fields.domesticServices;
    this.internationalServices = fields.internationalServices;
    this.rateMarkup = fields.rateMarkup;
    this.emailsHandledBy = fields.emailsHandledBy;
    this.manufacturingLeadTimeDays = fields.manufacturingLeadTimeDays;
  }

  static fromConfig(c: ShippoAppConfig): ShippoAppFrontendConfig {
    return new ShippoAppFrontendConfig({
      id: c.id,
      name: c.name,
      shippoApiTokenMasked: c.shippoApiToken
        ? `...${c.shippoApiToken.slice(-4)}`
        : "",
      webhookSecretConfigured: c.webhookSecret.length > 0,
      autoPurchaseLabel: c.autoPurchaseLabel,
      labelFileType: c.labelFileType,
      originAddress: c.originAddress,
      packageDefaults: c.packageDefaults,
      domesticServices: c.domesticServices,
      internationalServices: c.internationalServices,
      rateMarkup: c.rateMarkup,
      emailsHandledBy: c.emailsHandledBy,
      manufacturingLeadTimeDays: c.manufacturingLeadTimeDays,
    });
  }
}
