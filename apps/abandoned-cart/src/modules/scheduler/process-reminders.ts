import { err, ok, Result } from "neverthrow";

import { createLogger } from "@/lib/logger";
import { CartRecord } from "@/modules/app-config/domain/cart-record";
import { AbandonedCartRepo, BaseAccess } from "@/modules/app-config/repositories/repo";
import { EmailSender } from "@/modules/email/email-sender";
import { buildContext, renderTemplate } from "@/modules/email/template-renderer";

import { decideNextAction } from "./reminder-decider";

const logger = createLogger("ProcessReminders");

export type ProcessSummary = {
  scanned: number;
  sent: number;
  skipped: Record<string, number>;
  errors: number;
};

/**
 * One scheduler pass for a single tenant: load config + live carts, evaluate
 * each cart's next action, send if due, mark the reminder as sent. Designed
 * to be safe to re-run — the decider re-checks `remindersSent` each pass.
 */
export class ProcessRemindersUseCase {
  constructor(
    private readonly repo: AbandonedCartRepo,
    private readonly emailSender: EmailSender,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(access: BaseAccess): Promise<Result<ProcessSummary, Error>> {
    const configResult = await this.repo.getConfig(access);

    if (configResult.isErr()) return err(configResult.error);
    const config = configResult.value;

    if (!config) return ok({ scanned: 0, sent: 0, skipped: {}, errors: 0 });

    if (!config.smtp) {
      logger.warn("App configured but SMTP missing — refusing to send anything");

      return ok({ scanned: 0, sent: 0, skipped: { "no-smtp": 1 }, errors: 0 });
    }

    const cartsResult = await this.repo.listLiveCarts(access);

    if (cartsResult.isErr()) return err(cartsResult.error);

    const now = this.clock();
    const summary: ProcessSummary = { scanned: 0, sent: 0, skipped: {}, errors: 0 };

    for (const cart of cartsResult.value) {
      summary.scanned += 1;

      const latestSend = cart.email
        ? (await this.repo.findLatestSendByEmail({ access, email: cart.email })).match(
            (v) => v,
            () => null,
          )
        : null;

      const decision = decideNextAction({
        cart,
        config,
        now,
        latestSendToEmailAt: latestSend,
      });

      if (decision.kind === "skip") {
        summary.skipped[decision.reason] = (summary.skipped[decision.reason] ?? 0) + 1;
        continue;
      }

      const context = buildContext({
        cart,
        storefrontUrl: config.storefrontUrl,
        storeName: config.storeName,
      });
      const sendResult = await this.emailSender.send({
        config: config.smtp,
        email: {
          to: cart.email!,
          subject: renderTemplate(decision.reminder.subject, context),
          html: renderTemplate(decision.reminder.bodyHtml, context),
        },
      });

      if (sendResult.isErr()) {
        summary.errors += 1;
        continue;
      }

      /*
       * Stamp the reminder as sent and persist. If the persist fails we may
       * double-send on the next tick — accept that vs. dropping email entirely.
       */
      const updated = CartRecord.create({
        ...cart.toJSON(),
        remindersSent: [
          ...cart.remindersSent,
          { reminderName: decision.reminder.name, sentAt: now.toISOString() },
        ],
      });

      if (updated.isErr()) {
        summary.errors += 1;
        continue;
      }

      const saveResult = await this.repo.saveCart({ access, cart: updated.value });

      if (saveResult.isErr()) {
        logger.warn("Sent email but failed to persist remindersSent", {
          checkoutId: cart.checkoutId,
        });
        summary.errors += 1;
        continue;
      }

      summary.sent += 1;
    }

    logger.info("Scheduler pass complete", summary);

    return ok(summary);
  }
}
