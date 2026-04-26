import { captureException } from "@sentry/nextjs";

import { createLogger } from "@/lib/logger";
import { withLoggerContext } from "@/lib/logger-context";
import { appConfigRepoImpl } from "@/modules/app-config/repositories/app-config-repo-impl";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { buildShippingEasyClient } from "@/modules/use-cases/build-client";
import { CancelShippingEasyOrderUseCase } from "@/modules/use-cases/cancel-shippingeasy-order";

import { orderCancelledWebhookDefinition } from "./webhook-definition";

const logger = createLogger("OrderCancelled route");

const useCase = new CancelShippingEasyOrderUseCase({
  configRepo: appConfigRepoImpl,
  buildClient: buildShippingEasyClient,
});

const handler = orderCancelledWebhookDefinition.createHandler(async (_req, ctx) => {
  try {
    const saleorApiUrlResult = createSaleorApiUrl(ctx.authData.saleorApiUrl);

    if (saleorApiUrlResult.isErr()) {
      return Response.json({ ok: false }, { status: 400 });
    }

    const order = ctx.payload.event?.order;

    if (!order) {
      return Response.json({ ok: true }, { status: 200 });
    }

    const result = await useCase.execute({
      saleorApiUrl: saleorApiUrlResult.value,
      appId: ctx.authData.appId,
      orderId: order.id,
      channelSlug: order.channel.slug,
      privateMetadata: order.privateMetadata.map((m) => ({ key: m.key, value: m.value })),
    });

    if (result.isErr()) {
      if (
        result.error._internalName === "CancelOrderError.NoLinkedOrder" ||
        result.error._internalName === "CancelOrderError.NotConfigured"
      ) {
        return Response.json({ ok: true, skipped: true }, { status: 200 });
      }
      logger.warn("Cancel order failed", { error: result.error.message });

      return Response.json({ ok: false, message: result.error.message }, { status: 500 });
    }

    return Response.json({ ok: true, ...result.value }, { status: 200 });
  } catch (error) {
    captureException(error);
    logger.error("Unhandled error in ORDER_CANCELLED", {
      message: (error as Error).message,
    });

    return Response.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
});

export const POST = withLoggerContext(handler);
