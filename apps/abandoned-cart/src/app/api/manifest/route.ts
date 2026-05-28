import { createManifestHandler } from "@saleor/app-sdk/handlers/next-app-router";
import { AppManifest } from "@saleor/app-sdk/types";

import { env } from "@/lib/env";
import { withLoggerContext } from "@/lib/logger-context";
import packageJson from "@/package.json";

import { checkoutCreatedWebhookDefinition } from "../webhooks/saleor/checkout-created/webhook-definition";
import { checkoutUpdatedWebhookDefinition } from "../webhooks/saleor/checkout-updated/webhook-definition";
import { orderCreatedWebhookDefinition } from "../webhooks/saleor/order-created/webhook-definition";

const handler = createManifestHandler({
  async manifestFactory({ appBaseUrl }) {
    const iframeBaseUrl = env.APP_IFRAME_BASE_URL ?? appBaseUrl;
    const apiBaseUrl = env.APP_API_BASE_URL ?? appBaseUrl;

    const manifest: AppManifest = {
      about:
        "Tracks abandoned checkouts and sends configurable recovery emails on a schedule. Per-channel templates, custom SMTP credentials, optional discount-code text in the email body.",
      appUrl: iframeBaseUrl,
      author: "88clipon",
      brand: {
        logo: { default: `${apiBaseUrl}/logo.png` },
      },
      dataPrivacyUrl: "https://88clipon.com/privacy",
      extensions: [],
      homepageUrl: "https://88clipon.com",
      id: env.MANIFEST_APP_ID,
      name: env.APP_NAME,
      permissions: ["MANAGE_CHECKOUTS", "MANAGE_ORDERS"],
      requiredSaleorVersion: ">=3.21 <4",
      supportUrl: "https://88clipon.com",
      tokenTargetUrl: `${apiBaseUrl}/api/register`,
      version: packageJson.version,
      webhooks: [
        checkoutCreatedWebhookDefinition.getWebhookManifest(apiBaseUrl),
        checkoutUpdatedWebhookDefinition.getWebhookManifest(apiBaseUrl),
        orderCreatedWebhookDefinition.getWebhookManifest(apiBaseUrl),
      ],
    };

    return manifest;
  },
});

export const GET = withLoggerContext(handler);
