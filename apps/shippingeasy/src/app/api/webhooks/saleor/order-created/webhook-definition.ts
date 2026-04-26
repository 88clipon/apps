import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next-app-router";

import { OrderCreatedDocument, OrderCreatedSubscription } from "@/generated/graphql";
import { saleorApp } from "@/lib/saleor-app";

import { verifyWebhookSignature } from "../verify-signature";

export const orderCreatedWebhookDefinition = new SaleorAsyncWebhook<OrderCreatedSubscription>({
  apl: saleorApp.apl,
  event: "ORDER_CREATED",
  name: "ShippingEasy order created",
  isActive: true,
  query: OrderCreatedDocument,
  webhookPath: "api/webhooks/saleor/order-created",
  verifySignatureFn: (jwks, signature, rawBody) => verifyWebhookSignature(jwks, signature, rawBody),
});
