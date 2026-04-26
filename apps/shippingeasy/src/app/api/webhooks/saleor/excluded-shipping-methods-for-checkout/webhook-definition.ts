import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next-app-router";

import {
  ExcludedShippingMethodsForCheckoutDocument,
  ExcludedShippingMethodsForCheckoutSubscription,
} from "@/generated/graphql";
import { saleorApp } from "@/lib/saleor-app";

import { verifyWebhookSignature } from "../verify-signature";

export const excludedShippingMethodsForCheckoutWebhookDefinition =
  new SaleorSyncWebhook<ExcludedShippingMethodsForCheckoutSubscription>({
    apl: saleorApp.apl,
    event: "CHECKOUT_FILTER_SHIPPING_METHODS",
    name: "ShippingEasy excluded shipping methods",
    isActive: false,
    query: ExcludedShippingMethodsForCheckoutDocument,
    webhookPath: "api/webhooks/saleor/excluded-shipping-methods-for-checkout",
    verifySignatureFn: (jwks, signature, rawBody) =>
      verifyWebhookSignature(jwks, signature, rawBody),
  });
