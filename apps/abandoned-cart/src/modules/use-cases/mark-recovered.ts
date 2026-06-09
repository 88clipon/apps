import { err, ok, Result } from "neverthrow";

import { createLogger } from "@/lib/logger";
import { CartRecord } from "@/modules/app-config/domain/cart-record";
import { AbandonedCartRepo, BaseAccess } from "@/modules/app-config/repositories/repo";
import { EmailSender } from "@/modules/email/email-sender";

const logger = createLogger("MarkRecoveredUseCase");

export type OrderCreatedPayload = {
  order?: {
    number?: string | null;
    checkoutId?: string | null;
    userEmail?: string | null;
    total?: {
      gross?: { amount?: number | null; currency?: string | null } | null;
    } | null;
  } | null;
};

const formatMoney = (amount: number, currency: string) =>
  `${currency === "USD" ? "$" : ""}${amount.toFixed(2)}${currency === "USD" ? "" : ` ${currency}`}`;

/**
 * On ORDER_CREATED, look up the matching tracked cart by checkout token and
 * mark it as recovered. When the merchant has configured a conversion-notify
 * address, also send an internal "a cart converted" email. No-op if we never
 * tracked the cart (e.g. order from an untargeted channel).
 */
export class MarkRecoveredUseCase {
  constructor(
    private readonly repo: AbandonedCartRepo,
    private readonly emailSender?: EmailSender,
  ) {}

  async execute(args: {
    access: BaseAccess;
    payload: OrderCreatedPayload;
  }): Promise<Result<{ recovered: boolean; notified: boolean }, Error>> {
    const checkoutId = args.payload.order?.checkoutId;

    if (!checkoutId) {
      logger.debug("ORDER_CREATED with no checkoutId — likely a direct order, skipping");

      return ok({ recovered: false, notified: false });
    }

    const existingResult = await this.repo.getCart({ access: args.access, checkoutId });

    if (existingResult.isErr()) return err(existingResult.error);
    const existing = existingResult.value;

    if (!existing || existing.recoveredAt) {
      return ok({ recovered: false, notified: false });
    }

    const updated = CartRecord.create({
      ...existing.toJSON(),
      recoveredAt: new Date().toISOString(),
    });

    if (updated.isErr()) {
      logger.warn("Failed to mark cart recovered (validation)", { error: updated.error });

      return ok({ recovered: false, notified: false });
    }

    const saveResult = await this.repo.saveCart({ access: args.access, cart: updated.value });

    if (saveResult.isErr()) return err(saveResult.error);

    logger.info("Cart recovered", {
      checkoutId,
      hadRemindersSent: existing.remindersSent.length,
    });

    const notified = await this.maybeNotify({ access: args.access, cart: existing, payload: args.payload });

    return ok({ recovered: true, notified });
  }

  /**
   * Sends the internal conversion notification, if configured. Failures here
   * never fail the webhook — the recovery is already persisted.
   */
  private async maybeNotify(args: {
    access: BaseAccess;
    cart: CartRecord;
    payload: OrderCreatedPayload;
  }): Promise<boolean> {
    if (!this.emailSender) return false;

    const configResult = await this.repo.getConfig(args.access);

    if (configResult.isErr()) return false;
    const config = configResult.value;

    if (!config?.conversionNotifyEmail || !config.smtp) return false;

    // Prefer the order's actual total; fall back to the tracked cart value.
    const amount = args.payload.order?.total?.gross?.amount ?? args.cart.totalAmount;
    const currency = args.payload.order?.total?.gross?.currency ?? args.cart.currency;
    const value = formatMoney(amount, currency);

    const customerName =
      [args.cart.customerFirstName, args.cart.customerLastName].filter(Boolean).join(" ") ||
      args.cart.email ||
      "a customer";
    const orderNumber = args.payload.order?.number;
    const remindersSent = args.cart.remindersSent.length;

    const sendResult = await this.emailSender.send({
      config: config.smtp,
      email: {
        to: config.conversionNotifyEmail,
        subject: `An abandoned cart was converted to an order (${value} Total Value)`,
        html: [
          `<p>An abandoned cart was recovered and converted to an order.</p>`,
          `<ul>`,
          `<li><strong>Order value:</strong> ${value}</li>`,
          orderNumber ? `<li><strong>Order number:</strong> #${orderNumber}</li>` : "",
          `<li><strong>Customer:</strong> ${customerName}</li>`,
          args.cart.email ? `<li><strong>Email:</strong> ${args.cart.email}</li>` : "",
          `<li><strong>Reminder emails sent before conversion:</strong> ${remindersSent}</li>`,
          `<li><strong>Channel:</strong> ${args.cart.channelSlug}</li>`,
          `</ul>`,
        ].join(""),
      },
    });

    if (sendResult.isErr()) {
      logger.warn("Conversion notification failed to send", {
        message: sendResult.error.message,
      });

      return false;
    }

    logger.info("Conversion notification sent", { to: config.conversionNotifyEmail });

    return true;
  }
}
