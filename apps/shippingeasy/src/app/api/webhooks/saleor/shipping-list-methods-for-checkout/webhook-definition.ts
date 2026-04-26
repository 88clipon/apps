import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next-app-router";

import {
  ShippingListMethodsForCheckoutDocument,
  ShippingListMethodsForCheckoutSubscription,
} from "@/generated/graphql";
import { saleorApp } from "@/lib/saleor-app";

import { verifyWebhookSignature } from "../verify-signature";

export const shippingListMethodsForCheckoutWebhookDefinition =
  new SaleorSyncWebhook<ShippingListMethodsForCheckoutSubscription>({
    apl: saleorApp.apl,
    event: "SHIPPING_LIST_METHODS_FOR_CHECKOUT",
    name: "ShippingEasy list methods for checkout",
    isActive: true,
    query: ShippingListMethodsForCheckoutDocument,
    webhookPath: "api/webhooks/saleor/shipping-list-methods-for-checkout",
    verifySignatureFn: (jwks, signature, rawBody) =>
      verifyWebhookSignature(jwks, signature, rawBody),
  });
