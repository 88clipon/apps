import { captureException } from "@sentry/nextjs";
import { NextRequest } from "next/server";
import { z } from "zod";

import { createAuthenticatedGraphQLClient } from "@/lib/graphql-client";
import { createLogger } from "@/lib/logger";
import { withLoggerContext } from "@/lib/logger-context";
import { saleorApp } from "@/lib/saleor-app";
import { appConfigRepoImpl } from "@/modules/app-config/repositories/app-config-repo-impl";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { SaleorGateway } from "@/modules/saleor/saleor-gateway";
import { verifyShippoAuthSignature } from "@/modules/shippo/shippo-webhook-signing";
import { idempotencyStore, orderLinkStore } from "@/modules/use-cases/factories";
import { SyncTrackingToSaleorUseCase } from "@/modules/use-cases/sync-tracking-to-saleor";

const logger = createLogger("Shippo inbound webhook");

const envelopeSchema = z.object({
  event: z.string(),
  test: z.boolean().optional(),
  data: z.unknown().optional(),
});

const getMetadata = (data: unknown): string | null => {
  if (!data || typeof data !== "object") return null;
  const m = (data as { metadata?: unknown }).metadata;

  if (m == null) return null;
  if (typeof m === "string") return m;

  return null;
};

const getTracking = (data: unknown): string | null => {
  if (!data || typeof data !== "object") return null;
  const t = (data as { tracking_number?: unknown }).tracking_number;

  return typeof t === "string" && t.length > 0 ? t : null;
};

const getTransactionObjectId = (data: unknown): string | null => {
  if (!data || typeof data !== "object") return null;
  const id = (data as { object_id?: unknown }).object_id;

  return typeof id === "string" ? id : null;
};

const handler = async (req: NextRequest) => {
  try {
    const rawBody = await req.text();

  const saleorApiUrlRaw =
    req.nextUrl.searchParams.get("saleorApiUrl") ??
    req.headers.get("x-shippo-saleor-api-url") ??
    "";

  const saleorApiUrlResult = createSaleorApiUrl(saleorApiUrlRaw);

  if (saleorApiUrlResult.isErr()) {
    logger.warn("Inbound Shippo webhook missing/invalid saleorApiUrl", { raw: saleorApiUrlRaw });

    return Response.json(
      { ok: false, message: "Missing or invalid saleorApiUrl query/header" },
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

  const signatureHeader =
    req.headers.get("shippo-auth-signature") ?? req.headers.get("Shippo-Auth-Signature");

  const configsWithSecret = Array.from(rootConfigResult.value.configs.values()).filter(
    (c) => c.webhookSecret.length > 0,
  );

  if (configsWithSecret.length > 0) {
    const matched = configsWithSecret.find((c) =>
      verifyShippoAuthSignature({
        rawBody,
        signatureHeader,
        secret: c.webhookSecret,
      }),
    );

    if (!matched) {
      logger.warn("Shippo webhook signature did not match any configured webhook secret");

      return Response.json({ ok: false, message: "Invalid signature" }, { status: 401 });
    }
  } else if (signatureHeader) {
    logger.warn(
      "Shippo webhook included Shippo-Auth-Signature but no webhook secret is saved in app config; accepting",
    );
  }

  let parsed: z.infer<typeof envelopeSchema>;

  try {
    parsed = envelopeSchema.parse(JSON.parse(rawBody));
  } catch (e) {
    logger.warn("Invalid Shippo webhook payload", { error: e });

    return Response.json({ ok: false, message: "Invalid payload" }, { status: 400 });
  }

  const { event } = parsed;
  const data = parsed.data;

  if (event === "transaction_created" || event === "transaction_updated") {
    const txId = getTransactionObjectId(data);

    if (txId) {
      const proceed = await idempotencyStore().tryLock({
        saleorApiUrl,
        appId: authData.appId,
        eventId: `${event}:${txId}`,
      });

      if (!proceed) {
        return Response.json({ ok: true, deduplicated: true }, { status: 200 });
      }
    }
  }

  const externalOrderId = getMetadata(data);

  if (!externalOrderId) {
    logger.warn("Shippo webhook missing metadata reference", { event });

    return Response.json({ ok: true, skipped: true }, { status: 200 });
  }

  const link = await orderLinkStore().findByExternalId({
    saleorApiUrl,
    appId: authData.appId,
    externalOrderId,
  });

  if (!link) {
    logger.warn("No order link for Shippo metadata reference", { externalOrderId });

    return Response.json({ ok: true, skipped: true }, { status: 200 });
  }

  const cfg = rootConfigResult.value.getConfigForChannel(link.channelSlug);
  const suppressSaleorEmails = cfg?.emailsHandledBy === "shippo";

  const tracking = getTracking(data);

  if (
    !tracking &&
    (event === "transaction_created" ||
      event === "transaction_updated" ||
      event === "track_updated")
  ) {
    return Response.json({ ok: true, skipped: true }, { status: 200 });
  }

  if (!tracking) {
    return Response.json({ ok: true, ignored: true }, { status: 200 });
  }

  const useCase = new SyncTrackingToSaleorUseCase({
    buildSaleorGateway: ({ saleorApiUrl: url, token }) =>
      new SaleorGateway(createAuthenticatedGraphQLClient({ saleorApiUrl: url, token })),
  });

  const result = await useCase.execute(
    {
      saleorOrderId: link.saleorOrderId,
      trackingNumber: tracking,
      suppressSaleorEmails,
    },
    { saleorApiUrl, token: authData.token },
  );

  if (result.isErr()) {
    logger.warn("Sync tracking failed", { error: result.error.message });

    if (
      result.error._internalName === "SyncTrackingError.AlreadyFulfilled" ||
      result.error._internalName === "SyncTrackingError.OrderNotFound"
    ) {
      return Response.json({ ok: true, skipped: true }, { status: 200 });
    }

    return Response.json({ ok: false, message: result.error.message }, { status: 500 });
  }

  return Response.json({ ok: true, ...result.value }, { status: 200 });
  } catch (error) {
    captureException(error);
    logger.error("Unhandled Shippo webhook error", { message: (error as Error).message });

    return Response.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
};

export const POST = withLoggerContext(handler);
