import { err, ok, Result } from "neverthrow";

import { createLogger } from "@/lib/logger";
import { AppConfig } from "@/modules/app-config/domain/app-config";
import { CartRecord, CartRecordInput } from "@/modules/app-config/domain/cart-record";
import { AbandonedCartRepo, BaseAccess } from "@/modules/app-config/repositories/repo";

const logger = createLogger("TrackCheckoutUseCase");

const DEFAULT_RETENTION_DAYS = 30;

export type CheckoutWebhookPayload = {
  checkout?: {
    token?: string | null;
    email?: string | null;
    created?: string | null;
    lastChange?: string | null;
    channel?: { slug?: string | null } | null;
    user?: {
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
    } | null;
    totalPrice?: {
      gross?: { amount?: number | null; currency?: string | null } | null;
    } | null;
    lines?: Array<{
      quantity: number;
      variant?: {
        name?: string | null;
        product?: { name?: string | null } | null;
        pricing?: { price?: { gross?: { amount?: number | null } | null } | null } | null;
      } | null;
    }> | null;
  } | null;
};

/**
 * Idempotently upsert a tracked cart row from a CHECKOUT_CREATED or
 * CHECKOUT_UPDATED webhook payload. Preserves any reminders that were already
 * sent (so an UPDATED webhook after a reminder fires doesn't trigger a resend).
 */
export class TrackCheckoutUseCase {
  constructor(private readonly repo: AbandonedCartRepo) {}

  async execute(args: {
    access: BaseAccess;
    payload: CheckoutWebhookPayload;
  }): Promise<Result<{ tracked: boolean; reason?: string }, Error>> {
    const checkout = args.payload.checkout;

    logger.info("Checkout webhook received", {
      hasCheckout: !!checkout,
      token: checkout?.token ?? null,
      channelSlug: checkout?.channel?.slug ?? null,
      hasEmail: !!(checkout?.email ?? checkout?.user?.email),
    });

    if (!checkout?.token) {
      logger.info("Skipping — no checkout token on payload");

      return ok({ tracked: false, reason: "missing-checkout-token" });
    }

    if (!checkout.channel?.slug) {
      logger.info("Skipping — no channel slug on payload", { token: checkout.token });

      return ok({ tracked: false, reason: "missing-channel-slug" });
    }

    const configResult = await this.repo.getConfig(args.access);

    if (configResult.isErr()) return err(configResult.error);
    const config = configResult.value;

    if (!config) {
      logger.info("Skipping — app not configured yet");

      return ok({ tracked: false, reason: "app-not-configured" });
    }

    if (!config.programFor(checkout.channel.slug)) {
      logger.info("Skipping — channel has no enabled program", {
        channelSlug: checkout.channel.slug,
        configuredChannels: config.programs.map((p) => p.channelSlug),
      });

      return ok({ tracked: false, reason: "channel-not-targeted" });
    }

    const existingResult = await this.repo.getCart({
      access: args.access,
      checkoutId: checkout.token,
    });

    if (existingResult.isErr()) return err(existingResult.error);
    const existing = existingResult.value;

    const email = checkout.email ?? checkout.user?.email ?? null;
    const now = new Date().toISOString();
    /*
     * Normalize Saleor's timestamps (microseconds + numeric offset) to clean
     * UTC ISO so storage and the scheduler's date math stay consistent.
     */
    const normalize = (raw: string | null | undefined): string | null => {
      if (!raw) return null;
      const t = new Date(raw).getTime();

      return Number.isNaN(t) ? null : new Date(t).toISOString();
    };
    const lastUpdatedAt = normalize(checkout.lastChange) ?? now;
    const createdAt = existing?.createdAt ?? normalize(checkout.created) ?? now;
    const retentionDays = config.retentionDays || DEFAULT_RETENTION_DAYS;
    const ttl = Math.floor(new Date(lastUpdatedAt).getTime() / 1000) + retentionDays * 86400;

    const input: CartRecordInput = {
      checkoutId: checkout.token,
      saleorApiUrl: args.access.saleorApiUrl,
      appId: args.access.appId,
      channelSlug: checkout.channel.slug,
      email,
      customerFirstName: checkout.user?.firstName ?? null,
      customerLastName: checkout.user?.lastName ?? null,
      totalAmount: checkout.totalPrice?.gross?.amount ?? 0,
      currency: checkout.totalPrice?.gross?.currency ?? "USD",
      lines: (checkout.lines ?? []).map((l) => ({
        name: l.variant?.product?.name ?? l.variant?.name ?? "Item",
        quantity: l.quantity,
        unitPrice: l.variant?.pricing?.price?.gross?.amount ?? 0,
      })),
      lastUpdatedAt,
      createdAt,
      remindersSent: existing ? [...existing.remindersSent] : [],
      recoveredAt: existing?.recoveredAt ?? null,
      unsubscribedAt: existing?.unsubscribedAt ?? null,
      ttl,
    };

    const cartResult = CartRecord.create(input);

    if (cartResult.isErr()) {
      logger.warn("Cart record validation failed", { error: cartResult.error });

      return ok({ tracked: false, reason: "validation-failed" });
    }

    const saveResult = await this.repo.saveCart({ access: args.access, cart: cartResult.value });

    if (saveResult.isErr()) return err(saveResult.error);

    logger.info("Cart tracked", {
      checkoutId: checkout.token,
      hasEmail: !!email,
      channelSlug: checkout.channel.slug,
    });

    return ok({ tracked: true });
  }
}

/** Type-only export for callers needing the loaded config shape. */
export type _AppConfigUnused = AppConfig;
