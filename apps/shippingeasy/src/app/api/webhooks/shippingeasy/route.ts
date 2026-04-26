import { captureException } from "@sentry/nextjs";
import { NextRequest } from "next/server";

import { createAuthenticatedGraphQLClient } from "@/lib/graphql-client";
import { createLogger } from "@/lib/logger";
import { withLoggerContext } from "@/lib/logger-context";
import { saleorApp } from "@/lib/saleor-app";
import { appConfigRepoImpl } from "@/modules/app-config/repositories/app-config-repo-impl";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { SaleorGateway } from "@/modules/saleor/saleor-gateway";
import { shippingEasyWebhookEventSchema } from "@/modules/shippingeasy/shippingeasy-schemas";
import { verifyShippingEasyWebhookSignature } from "@/modules/shippingeasy/shippingeasy-signing";
import { idempotencyStore, orderLinkStore } from "@/modules/use-cases/factories";
import { SyncTrackingFromShippingEasyUseCase } from "@/modules/use-cases/sync-tracking-from-shippingeasy";

const logger = createLogger("ShippingEasy inbound webhook");

const useCase = new SyncTrackingFromShippingEasyUseCase({
  configRepo: appConfigRepoImpl,
  buildSaleorGateway: ({ saleorApiUrl, token }) =>
    new SaleorGateway(createAuthenticatedGraphQLClient({ saleorApiUrl, token })),
});

const handler = async (req: NextRequest) => {
  const rawBody = await req.text();

  /**
   * The inbound webhook must tell us which Saleor installation it belongs to.
   * We accept two approaches (merchant picks one when configuring the webhook
   * inside ShippingEasy):
   *   - query param:    ?saleorApiUrl=...
   *   - custom header:  X-SE-Saleor-Api-Url
   */
  const saleorApiUrlRaw =
    req.nextUrl.searchParams.get("saleorApiUrl") ??
    req.headers.get("x-se-saleor-api-url") ??
    "";
  const saleorApiUrlResult = createSaleorApiUrl(saleorApiUrlRaw);

  if (saleorApiUrlResult.isErr()) {
    logger.warn("Inbound webhook missing/invalid saleorApiUrl", { raw: saleorApiUrlRaw });

    return Response.json(
      { ok: false, message: "Missing or invalid saleorApiUrl" },
      { status: 400 },
    );
  }

  const saleorApiUrl = saleorApiUrlResult.value;
  const authData = await saleorApp.apl.get(saleorApiUrl);

  if (!authData) {
    logger.warn("No APL entry for saleorApiUrl", { saleorApiUrl });

    return Response.json({ ok: false, message: "App not installed" }, { status: 404 });
  }

  const rootConfigResult = await appConfigRepoImpl.getRootConfig({
    saleorApiUrl,
    appId: authData.appId,
  });

  if (rootConfigResult.isErr()) {
    logger.warn("Failed to load app config", { error: rootConfigResult.error.message });

    return Response.json({ ok: false }, { status: 500 });
  }

  const signatureHeader = req.headers.get("x-se-signature") ?? req.headers.get("x-shippingeasy-signature");

  /**
   * Try to verify the signature against every config's webhook secret. The
   * first successful verification wins; we then carry that config forward
   * for rate markup / email preferences.
   */
  const matchedConfig = Array.from(rootConfigResult.value.configs.values()).find((c) =>
    verifyShippingEasyWebhookSignature({
      apiSecret: c.webhookSecret,
      rawBody,
      signatureHeader,
    }),
  );

  if (!matchedConfig) {
    logger.warn("Inbound webhook signature did not match any configured webhook secret");

    return Response.json({ ok: false, message: "Invalid signature" }, { status: 401 });
  }

  let parsedEvent;

  try {
    parsedEvent = shippingEasyWebhookEventSchema.parse(JSON.parse(rawBody));
  } catch (e) {
    logger.warn("Invalid ShippingEasy webhook payload", { error: e });

    return Response.json({ ok: false, message: "Invalid payload" }, { status: 400 });
  }

  if (parsedEvent.event_id) {
    const proceed = await idempotencyStore().tryLock({
      saleorApiUrl,
      appId: authData.appId,
      eventId: parsedEvent.event_id,
    });

    if (!proceed) {
      logger.info("Duplicate ShippingEasy webhook; skipping", {
        eventId: parsedEvent.event_id,
      });

      return Response.json({ ok: true, deduplicated: true }, { status: 200 });
    }
  }

  const externalOrderId = parsedEvent.data?.external_order_identifier;

  if (!externalOrderId) {
    logger.warn("Inbound webhook missing external_order_identifier", {
      event: parsedEvent.event,
    });

    return Response.json({ ok: true, skipped: true }, { status: 200 });
  }

  const link = await orderLinkStore().findByExternalId({
    saleorApiUrl,
    appId: authData.appId,
    externalOrderId,
  });

  if (!link) {
    logger.warn("No order link found for external_order_identifier", { externalOrderId });

    return Response.json({ ok: true, skipped: true }, { status: 200 });
  }

  switch (parsedEvent.event) {
    case "label.created":
    case "shipment.updated": {
      const result = await useCase.execute(
        {
          saleorApiUrl,
          appId: authData.appId,
          event: parsedEvent,
          saleorOrderId: link.saleorOrderId,
          suppressSaleorEmails: matchedConfig.emailsHandledBy === "shippingeasy",
        },
        { saleorApiUrl, token: authData.token },
      );

      if (result.isErr()) {
        logger.warn("Sync tracking use case failed", { error: result.error.message });
        /**
         * Return 200 for "already fulfilled" or "order not found" so
         * ShippingEasy doesn't retry forever, but 5xx for transient
         * Saleor errors so they *are* retried.
         */
        if (
          result.error._internalName === "SyncTrackingError.AlreadyFulfilled" ||
          result.error._internalName === "SyncTrackingError.OrderNotFound"
        ) {
          return Response.json({ ok: true, skipped: true }, { status: 200 });
        }

        return Response.json(
          { ok: false, message: result.error.message },
          { status: 500 },
        );
      }

      return Response.json({ ok: true, ...result.value }, { status: 200 });
    }

    default:
      logger.debug("Ignoring unhandled ShippingEasy event", { event: parsedEvent.event });

      return Response.json({ ok: true, ignored: true }, { status: 200 });
  }
};

export const POST = withLoggerContext(async (req) => {
  try {
    return await handler(req as NextRequest);
  } catch (error) {
    captureException(error);
    logger.error("Unhandled inbound webhook error", {
      message: (error as Error).message,
    });

    return Response.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
});
