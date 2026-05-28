import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next-app-router";

import { CheckoutUpdatedDocument, CheckoutUpdatedSubscription } from "@/generated/graphql";
import { saleorApp } from "@/lib/saleor-app";

import { verifyWebhookSignature } from "../verify-signature";

export const checkoutUpdatedWebhookDefinition =
  new SaleorAsyncWebhook<CheckoutUpdatedSubscription>({
    apl: saleorApp.apl,
    event: "CHECKOUT_UPDATED",
    name: "Abandoned cart - checkout updated",
    isActive: true,
    query: CheckoutUpdatedDocument,
    webhookPath: "api/webhooks/saleor/checkout-updated",
    verifySignatureFn: (jwks, signature, rawBody) =>
      verifyWebhookSignature(jwks, signature, rawBody),
  });
