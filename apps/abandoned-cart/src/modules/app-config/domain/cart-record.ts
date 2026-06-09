import { err, ok, Result } from "neverthrow";
import { z } from "zod";

import { BaseError } from "@/lib/errors";

/** What we know about a single line in an abandoned checkout. */
export const cartLineSchema = z.object({
  name: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

/**
 * Per-reminder send record. `sentAt` is null until the scheduler successfully
 * dispatches the email; that's how we avoid double-sending.
 */
export const sentReminderSchema = z.object({
  reminderName: z.string().min(1),
  sentAt: z.string().datetime(),
});
export type SentReminder = z.infer<typeof sentReminderSchema>;

/**
 * One tracked abandoned-checkout row in DynamoDB. Created on `CHECKOUT_CREATED`,
 * updated on `CHECKOUT_UPDATED`, and marked recovered (via `recoveredAt`) when
 * an `ORDER_CREATED` webhook arrives for the same checkout token.
 */
export const cartRecordSchema = z.object({
  /** Saleor checkout token — unique per cart. */
  checkoutId: z.string().min(1),
  saleorApiUrl: z.string().min(1),
  appId: z.string().min(1),
  channelSlug: z.string().min(1),
  email: z.string().email().nullable(),
  customerFirstName: z.string().nullable(),
  customerLastName: z.string().nullable(),
  totalAmount: z.number().nonnegative(),
  currency: z.string().length(3),
  lines: z.array(cartLineSchema),
  /** ISO timestamp of last activity on the checkout. Reset on UPDATED. */
  lastUpdatedAt: z.string().datetime(),
  /** ISO timestamp the checkout first showed up via CREATED. */
  createdAt: z.string().datetime(),
  /** Reminders already dispatched. Driven by the scheduler. */
  remindersSent: z.array(sentReminderSchema).default([]),
  /** Set when the customer comes back and places an order. */
  recoveredAt: z.string().datetime().nullable().default(null),
  /** Set when the customer unsubscribes via the email's footer link. */
  unsubscribedAt: z.string().datetime().nullable().default(null),
  /**
   * DynamoDB TTL — Unix epoch seconds. Set by the repo to
   * `lastUpdatedAt + retentionDays`. DynamoDB auto-deletes rows when crossed.
   */
  ttl: z.number().int().positive(),
});
export type CartRecordFields = z.infer<typeof cartRecordSchema>;
export type CartRecordInput = z.input<typeof cartRecordSchema>;

export const CartRecordValidationError = BaseError.subclass("CartRecordValidationError", {
  props: { _internalName: "CartRecord.ValidationError" as const },
});

export class CartRecord {
  readonly checkoutId: string;
  readonly saleorApiUrl: string;
  readonly appId: string;
  readonly channelSlug: string;
  readonly email: string | null;
  readonly customerFirstName: string | null;
  readonly customerLastName: string | null;
  readonly totalAmount: number;
  readonly currency: string;
  readonly lines: readonly CartLine[];
  readonly lastUpdatedAt: string;
  readonly createdAt: string;
  readonly remindersSent: readonly SentReminder[];
  readonly recoveredAt: string | null;
  readonly unsubscribedAt: string | null;
  readonly ttl: number;

  private constructor(fields: CartRecordFields) {
    this.checkoutId = fields.checkoutId;
    this.saleorApiUrl = fields.saleorApiUrl;
    this.appId = fields.appId;
    this.channelSlug = fields.channelSlug;
    this.email = fields.email;
    this.customerFirstName = fields.customerFirstName;
    this.customerLastName = fields.customerLastName;
    this.totalAmount = fields.totalAmount;
    this.currency = fields.currency;
    this.lines = fields.lines;
    this.lastUpdatedAt = fields.lastUpdatedAt;
    this.createdAt = fields.createdAt;
    this.remindersSent = fields.remindersSent;
    this.recoveredAt = fields.recoveredAt;
    this.unsubscribedAt = fields.unsubscribedAt;
    this.ttl = fields.ttl;
  }

  static create(
    input: CartRecordInput,
  ): Result<CartRecord, InstanceType<typeof CartRecordValidationError>> {
    const parsed = cartRecordSchema.safeParse(input);

    if (!parsed.success) {
      return err(
        new CartRecordValidationError("Invalid cart record", { cause: parsed.error }),
      );
    }

    return ok(new CartRecord(parsed.data));
  }

  /** Is this cart eligible for the scheduler to look at (not converted / unsubscribed)? */
  get isLive(): boolean {
    return !this.recoveredAt && !this.unsubscribedAt && !!this.email;
  }

  /** Most recently sent reminder, or null if none sent yet. */
  get lastReminder(): SentReminder | null {
    if (this.remindersSent.length === 0) return null;

    return [...this.remindersSent].sort((a, b) => (a.sentAt > b.sentAt ? -1 : 1))[0];
  }

  toJSON(): CartRecordFields {
    return {
      checkoutId: this.checkoutId,
      saleorApiUrl: this.saleorApiUrl,
      appId: this.appId,
      channelSlug: this.channelSlug,
      email: this.email,
      customerFirstName: this.customerFirstName,
      customerLastName: this.customerLastName,
      totalAmount: this.totalAmount,
      currency: this.currency,
      lines: [...this.lines],
      lastUpdatedAt: this.lastUpdatedAt,
      createdAt: this.createdAt,
      remindersSent: [...this.remindersSent],
      recoveredAt: this.recoveredAt,
      unsubscribedAt: this.unsubscribedAt,
      ttl: this.ttl,
    };
  }
}
