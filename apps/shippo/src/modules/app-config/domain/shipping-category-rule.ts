import { err, ok, Result } from "neverthrow";
import { z } from "zod";

import { BaseError } from "@/lib/errors";

/**
 * Per-method rate spec. `mode = "fixed"` returns the configured fixedAmount
 * directly to Saleor without ever calling Shippo; `mode = "live"` calls Shippo
 * and uses whatever rate it returns for that service token.
 */
export const methodRuleSchema = z
  .object({
    serviceToken: z.string().min(1),
    mode: z.enum(["fixed", "live"]),
    fixedAmount: z.number().nonnegative().optional(),
    minTransitDays: z.number().int().nonnegative(),
    maxTransitDays: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "fixed" && value.fixedAmount === undefined) {
      ctx.addIssue({
        path: ["fixedAmount"],
        code: z.ZodIssueCode.custom,
        message: "fixedAmount is required when mode is 'fixed'",
      });
    }
    if (value.maxTransitDays < value.minTransitDays) {
      ctx.addIssue({
        path: ["maxTransitDays"],
        code: z.ZodIssueCode.custom,
        message: "maxTransitDays must be >= minTransitDays",
      });
    }
  });
export type MethodRule = z.infer<typeof methodRuleSchema>;

export const parcelDimsSchema = z.object({
  lengthIn: z.number().positive(),
  widthIn: z.number().positive(),
  heightIn: z.number().positive(),
});
export type ParcelDims = z.infer<typeof parcelDimsSchema>;

export const shippingCategoryRuleSchema = z.object({
  /** Saleor product category slug (unique within a config root). */
  categorySlug: z.string().min(1),
  /** Display name for the configuration UI (defaults to the category's name). */
  displayName: z.string().min(1),
  /**
   * When true, the rule contributes $0 for every method and never restricts
   * the cart's supported method set. Other fields are ignored.
   */
  freeShipping: z.boolean().default(false),
  /** Per-unit weight (ounces). Total parcel weight = sum(line.quantity) * this. */
  weightOzPerUnit: z.number().nonnegative().default(0),
  parcel: parcelDimsSchema.optional(),
  domesticMethods: z.array(methodRuleSchema).default([]),
  internationalMethods: z.array(methodRuleSchema).default([]),
});
export type ShippingCategoryRuleInput = z.input<typeof shippingCategoryRuleSchema>;
export type ShippingCategoryRuleFields = z.infer<typeof shippingCategoryRuleSchema>;

export const ShippingCategoryRuleValidationError = BaseError.subclass(
  "ShippingCategoryRuleValidationError",
  { props: { _internalName: "ShippingCategoryRule.ValidationError" as const } },
);

/** Domain class for a single shipping rule keyed by a Saleor category slug. */
export class ShippingCategoryRule {
  readonly categorySlug: string;
  readonly displayName: string;
  readonly freeShipping: boolean;
  readonly weightOzPerUnit: number;
  readonly parcel: ParcelDims | undefined;
  readonly domesticMethods: readonly MethodRule[];
  readonly internationalMethods: readonly MethodRule[];

  private constructor(fields: ShippingCategoryRuleFields) {
    this.categorySlug = fields.categorySlug;
    this.displayName = fields.displayName;
    this.freeShipping = fields.freeShipping;
    this.weightOzPerUnit = fields.weightOzPerUnit;
    this.parcel = fields.parcel;
    this.domesticMethods = fields.domesticMethods;
    this.internationalMethods = fields.internationalMethods;
  }

  static create(
    input: ShippingCategoryRuleInput,
  ): Result<
    ShippingCategoryRule,
    InstanceType<typeof ShippingCategoryRuleValidationError>
  > {
    const parsed = shippingCategoryRuleSchema.safeParse(input);

    if (!parsed.success) {
      return err(
        new ShippingCategoryRuleValidationError("Invalid shipping category rule", {
          cause: parsed.error,
        }),
      );
    }

    if (!parsed.data.freeShipping && !parsed.data.parcel) {
      return err(
        new ShippingCategoryRuleValidationError(
          "parcel dimensions are required when freeShipping is false",
        ),
      );
    }

    return ok(new ShippingCategoryRule(parsed.data));
  }

  /** Method list for a given zone. */
  methodsFor(zone: "domestic" | "international"): readonly MethodRule[] {
    return zone === "domestic" ? this.domesticMethods : this.internationalMethods;
  }

  toJSON(): ShippingCategoryRuleFields {
    return {
      categorySlug: this.categorySlug,
      displayName: this.displayName,
      freeShipping: this.freeShipping,
      weightOzPerUnit: this.weightOzPerUnit,
      parcel: this.parcel,
      domesticMethods: [...this.domesticMethods],
      internationalMethods: [...this.internationalMethods],
    };
  }
}
