import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next-app-router";

import { CheckoutCreatedDocument, CheckoutCreatedSubscription } from "@/generated/graphql";
import { saleorApp } from "@/lib/saleor-app";

import { verifyWebhookSignature } from "../verify-signature";

export const checkoutCreatedWebhookDefinition =
  new SaleorAsyncWebhook<CheckoutCreatedSubscription>({
    apl: saleorApp.apl,
    event: "CHECKOUT_CREATED",
    name: "Abandoned cart - checkout created",
    isActive: true,
    query: CheckoutCreatedDocument,
    webhookPath: "api/webhooks/saleor/checkout-created",
    verifySignatureFn: (jwks, signature, rawBody) =>
      verifyWebhookSignature(jwks, signature, rawBody),
  });
