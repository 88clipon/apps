import cron from "node-cron";

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { saleorApp } from "@/lib/saleor-app";
import { repoImpl } from "@/modules/app-config/repositories/repo-impl";
import { emailSender } from "@/modules/email/email-sender";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";

import { ProcessRemindersUseCase } from "./process-reminders";

const logger = createLogger("SchedulerBootstrap");

let started = false;

/**
 * Starts the in-process scheduler exactly once per Node process. Called from
 * the Next.js instrumentation hook so it runs on server boot, but NOT in dev
 * hot-reload cycles (Next dedupes instrumentation registration).
 *
 * Each tick:
 *   1. Asks the APL for the list of installations (tenants).
 *   2. Runs the reminder processor once per tenant.
 *
 * Failures in one tenant don't stop the others.
 */
export function startScheduler(): void {
  if (started) {
    logger.debug("Scheduler already started, skipping");

    return;
  }

  if (env.SCHEDULER_DISABLED) {
    logger.info("Scheduler disabled via env (SCHEDULER_DISABLED=true)");
    started = true;

    return;
  }

  const useCase = new ProcessRemindersUseCase(repoImpl, emailSender);
  const intervalSeconds = env.SCHEDULER_INTERVAL_SECONDS;
  /*
   * node-cron supports * pattern; convert seconds to a sec-resolution pattern
   * when the interval is < 60s, otherwise minute-resolution.
   */
  const pattern =
    intervalSeconds < 60
      ? `*/${intervalSeconds} * * * * *`
      : `*/${Math.max(1, Math.floor(intervalSeconds / 60))} * * * *`;

  cron.schedule(pattern, async () => {
    try {
      const installations = await listInstallations();

      for (const install of installations) {
        const apiUrl = createSaleorApiUrl(install.saleorApiUrl);

        if (apiUrl.isErr()) continue;

        const result = await useCase.execute({
          saleorApiUrl: apiUrl.value,
          appId: install.appId,
        });

        if (result.isErr()) {
          logger.warn("Scheduler tick errored for installation", {
            saleorApiUrl: install.saleorApiUrl,
            error: result.error,
          });
        }
      }
    } catch (error) {
      // Never let a thrown error kill the cron loop.
      logger.error("Scheduler tick threw", { message: String(error) });
    }
  });

  started = true;
  logger.info("Scheduler started", { pattern, intervalSeconds });
}

/**
 * Pulls the list of {saleorApiUrl, appId} pairs from the APL. The Saleor app
 * SDK's APL interface exposes `getAll()` for FileAPL / DynamoAPL / Cloud APL.
 */
async function listInstallations(): Promise<Array<{ saleorApiUrl: string; appId: string }>> {
  const apl = saleorApp.apl;

  // Type narrowing: the SDK's APL interface optionally exposes getAll().
  if (typeof (apl as { getAll?: () => Promise<unknown[]> }).getAll === "function") {
    const all = (await (apl as { getAll: () => Promise<Array<{ saleorApiUrl: string; appId: string }>> }).getAll()) ?? [];

    return all.map((a) => ({ saleorApiUrl: a.saleorApiUrl, appId: a.appId }));
  }

  logger.warn("APL doesn't implement getAll(); scheduler can't enumerate tenants");

  return [];
}
