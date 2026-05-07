export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { syncSaleorWebhookSubscriptionsFromManifest } = await import(
    "@/lib/sync-saleor-webhook-subscriptions"
  );

  await syncSaleorWebhookSubscriptionsFromManifest();
}
