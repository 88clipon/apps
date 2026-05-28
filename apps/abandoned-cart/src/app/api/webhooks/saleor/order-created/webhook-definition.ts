import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next-app-router";

import {
  AbandonedCartOrderCreatedDocument,
  AbandonedCartOrderCreatedSubscription,
} from "@/generated/graphql";
import { saleorApp } from "@/lib/saleor-app";

import { verifyWebhookSignature } from "../verify-signature";

export const orderCreatedWebhookDefinition =
  new SaleorAsyncWebhook<AbandonedCartOrderCreatedSubscription>({
    apl: saleorApp.apl,
    event: "ORDER_CREATED",
    name: "Abandoned cart - order created (recovery marker)",
    isActive: true,
    query: AbandonedCartOrderCreatedDocument,
    webhookPath: "api/webhooks/saleor/order-created",
    verifySignatureFn: (jwks, signature, rawBody) =>
      verifyWebhookSignature(jwks, signature, rawBody),
  });
