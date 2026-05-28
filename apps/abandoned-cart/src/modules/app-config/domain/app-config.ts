import { err, ok, Result } from "neverthrow";
import { z } from "zod";

import { BaseError } from "@/lib/errors";

/**
 * One scheduled reminder in a recovery sequence. Reminders fire in order;
 * `hoursAfterLastActivity` is measured from the checkout's `lastUpdatedAt`.
 *
 * The body / subject are Handlebars templates. Available merge variables:
 *   - {{customer.firstName}}, {{customer.lastName}}, {{customer.email}}
 *   - {{cart.recoveryUrl}}, {{cart.itemCount}}, {{cart.total}}, {{cart.currency}}
 *   - {{cart.items}} (array of {name, quantity, price})
 *   - {{store.name}}
 */
export const reminderSchema = z.object({
  name: z.string().min(1),
  hoursAfterLastActivity: z.number().positive(),
  subject: z.string().min(1),
  bodyHtml: z.string().min(1),
});
export type Reminder = z.infer<typeof reminderSchema>;

export const smtpConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().default(587),
  user: z.string().min(1),
  /**
   * Stored as-is. Treated as sensitive — never returned to the UI in plain
   * form except via the frontend representation, which masks it.
   */
  password: z.string().min(1),
  useTls: z.boolean().default(true),
  fromEmail: z.string().email(),
  fromName: z.string().min(1),
});
export type SmtpConfig = z.infer<typeof smtpConfigSchema>;

/**
 * Per-channel recovery program. Each channel can have its own template chain
 * (e.g. "default-channel" gets reminders at 1h / 24h / 72h; "wholesale" gets a
 * single 48h reminder). When a channel isn't listed, abandoned carts on that
 * channel are ignored.
 */
export const channelProgramSchema = z.object({
  channelSlug: z.string().min(1),
  enabled: z.boolean().default(true),
  reminders: z.array(reminderSchema).min(1),
  /**
   * Optional throttle: don't email the same address more than once per N hours
   * across all programs. Default 24h.
   */
  perEmailThrottleHours: z.number().nonnegative().default(24),
});
export type ChannelProgram = z.infer<typeof channelProgramSchema>;

export const appConfigSchema = z.object({
  smtp: smtpConfigSchema.optional(),
  /**
   * Storefront origin used to build the `cart.recoveryUrl` link in emails,
   * e.g. https://88clipon.com — the recovery URL is then
   *   `${storefrontUrl}/{channelSlug}/checkout?token={checkoutToken}`
   */
  storefrontUrl: z.string().url().optional(),
  /**
   * Storefront-facing brand name surfaced as `{{store.name}}` in templates.
   */
  storeName: z.string().min(1).default("88Clipon"),
  /**
   * Days to keep abandoned-cart records around before auto-purging. Recovered
   * carts are kept the same length for conversion stats. Default 30.
   */
  retentionDays: z.number().int().positive().default(30),
  programs: z.array(channelProgramSchema).default([]),
});
export type AppConfigFields = z.infer<typeof appConfigSchema>;
export type AppConfigInput = z.input<typeof appConfigSchema>;

export const AppConfigValidationError = BaseError.subclass("AppConfigValidationError", {
  props: { _internalName: "AppConfig.ValidationError" as const },
});

/** Domain object — the merchant's configuration of the abandoned-cart program. */
export class AppConfig {
  readonly smtp: SmtpConfig | undefined;
  readonly storefrontUrl: string | undefined;
  readonly storeName: string;
  readonly retentionDays: number;
  readonly programs: readonly ChannelProgram[];

  private constructor(fields: AppConfigFields) {
    this.smtp = fields.smtp;
    this.storefrontUrl = fields.storefrontUrl;
    this.storeName = fields.storeName;
    this.retentionDays = fields.retentionDays;
    this.programs = fields.programs;
  }

  static create(
    input: AppConfigInput,
  ): Result<AppConfig, InstanceType<typeof AppConfigValidationError>> {
    const parsed = appConfigSchema.safeParse(input);

    if (!parsed.success) {
      return err(
        new AppConfigValidationError("Invalid app config", { cause: parsed.error }),
      );
    }

    return ok(new AppConfig(parsed.data));
  }

  /** Look up the program for a given channel slug, or null if not configured. */
  programFor(channelSlug: string): ChannelProgram | null {
    return this.programs.find((p) => p.channelSlug === channelSlug && p.enabled) ?? null;
  }

  toJSON(): AppConfigFields {
    return {
      smtp: this.smtp,
      storefrontUrl: this.storefrontUrl,
      storeName: this.storeName,
      retentionDays: this.retentionDays,
      programs: this.programs.map((p) => ({ ...p, reminders: [...p.reminders] })),
    };
  }
}
