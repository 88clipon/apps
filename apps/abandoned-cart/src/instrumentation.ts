export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { syncSaleorWebhookSubscriptionsFromManifest } = await import(
    "@/lib/sync-saleor-webhook-subscriptions"
  );

  await syncSaleorWebhookSubscriptionsFromManifest();

  /*
   * Kick off the in-process reminder scheduler. Dedupes via internal flag so
   * hot-reloads / multi-runtime registration won't double-start it.
   */
  const { startScheduler } = await import("@/modules/scheduler/scheduler-bootstrap");

  startScheduler();
}
