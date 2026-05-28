import { err, ok, Result } from "neverthrow";

import { createLogger } from "@/lib/logger";
import { CartRecord } from "@/modules/app-config/domain/cart-record";
import { AbandonedCartRepo, BaseAccess } from "@/modules/app-config/repositories/repo";

const logger = createLogger("MarkRecoveredUseCase");

export type OrderCreatedPayload = {
  order?: {
    checkoutId?: string | null;
    userEmail?: string | null;
  } | null;
};

/**
 * On ORDER_CREATED, look up the matching tracked cart by checkout token and
 * mark it as recovered. No-op if we never tracked the cart (e.g. order from
 * an untargeted channel).
 */
export class MarkRecoveredUseCase {
  constructor(private readonly repo: AbandonedCartRepo) {}

  async execute(args: {
    access: BaseAccess;
    payload: OrderCreatedPayload;
  }): Promise<Result<{ recovered: boolean }, Error>> {
    const checkoutId = args.payload.order?.checkoutId;

    if (!checkoutId) {
      logger.debug("ORDER_CREATED with no checkoutId — likely a direct order, skipping");

      return ok({ recovered: false });
    }

    const existingResult = await this.repo.getCart({ access: args.access, checkoutId });

    if (existingResult.isErr()) return err(existingResult.error);
    const existing = existingResult.value;

    if (!existing) {
      return ok({ recovered: false });
    }

    if (existing.recoveredAt) {
      return ok({ recovered: false });
    }

    const updated = CartRecord.create({
      ...existing.toJSON(),
      recoveredAt: new Date().toISOString(),
    });

    if (updated.isErr()) {
      logger.warn("Failed to mark cart recovered (validation)", { error: updated.error });

      return ok({ recovered: false });
    }

    const saveResult = await this.repo.saveCart({ access: args.access, cart: updated.value });

    if (saveResult.isErr()) return err(saveResult.error);

    logger.info("Cart recovered", {
      checkoutId,
      hadRemindersSent: existing.remindersSent.length,
    });

    return ok({ recovered: true });
  }
}
