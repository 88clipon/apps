import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next-app-router";

import { OrderCancelledDocument, OrderCancelledSubscription } from "@/generated/graphql";
import { saleorApp } from "@/lib/saleor-app";

import { verifyWebhookSignature } from "../verify-signature";

export const orderCancelledWebhookDefinition = new SaleorAsyncWebhook<OrderCancelledSubscription>({
  apl: saleorApp.apl,
  event: "ORDER_CANCELLED",
  name: "ShippingEasy order cancelled",
  isActive: true,
  query: OrderCancelledDocument,
  webhookPath: "api/webhooks/saleor/order-cancelled",
  verifySignatureFn: (jwks, signature, rawBody) => verifyWebhookSignature(jwks, signature, rawBody),
});
