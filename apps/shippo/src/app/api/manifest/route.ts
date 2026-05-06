import { createManifestHandler } from "@saleor/app-sdk/handlers/next-app-router";
import { AppManifest } from "@saleor/app-sdk/types";

import { env } from "@/lib/env";
import { withLoggerContext } from "@/lib/logger-context";
import packageJson from "@/package.json";

import { excludedShippingMethodsForCheckoutWebhookDefinition } from "../webhooks/saleor/excluded-shipping-methods-for-checkout/webhook-definition";
import { orderCancelledWebhookDefinition } from "../webhooks/saleor/order-cancelled/webhook-definition";
import { orderCreatedWebhookDefinition } from "../webhooks/saleor/order-created/webhook-definition";
import { shippingListMethodsForCheckoutWebhookDefinition } from "../webhooks/saleor/shipping-list-methods-for-checkout/webhook-definition";

const handler = createManifestHandler({
  async manifestFactory({ appBaseUrl }) {
    const iframeBaseUrl = env.APP_IFRAME_BASE_URL ?? appBaseUrl;
    const apiBaseUrl = env.APP_API_BASE_URL ?? appBaseUrl;

    const manifest: AppManifest = {
      about:
        "Integrates Saleor with Shippo: live carrier rates at checkout, optional automatic label purchase, refunds on order cancel, and tracking/fulfillment sync via Shippo webhooks.",
      appUrl: iframeBaseUrl,
      author: "88clipon",
      brand: {
        logo: { default: `${apiBaseUrl}/logo.png` },
      },
      dataPrivacyUrl: "https://goshippo.com/privacy/",
      extensions: [],
      homepageUrl: "https://goshippo.com/",
      id: env.MANIFEST_APP_ID,
      name: env.APP_NAME,
      permissions: ["MANAGE_ORDERS", "MANAGE_CHECKOUTS", "HANDLE_CHECKOUTS", "MANAGE_SHIPPING"],
      requiredSaleorVersion: ">=3.21 <4",
      supportUrl: "https://goshippo.com/support/",
      tokenTargetUrl: `${apiBaseUrl}/api/register`,
      version: packageJson.version,
      webhooks: [
        shippingListMethodsForCheckoutWebhookDefinition.getWebhookManifest(apiBaseUrl),
        excludedShippingMethodsForCheckoutWebhookDefinition.getWebhookManifest(apiBaseUrl),
        orderCreatedWebhookDefinition.getWebhookManifest(apiBaseUrl),
        orderCancelledWebhookDefinition.getWebhookManifest(apiBaseUrl),
      ],
    };

    return manifest;
  },
});

export const GET = withLoggerContext(handler);
