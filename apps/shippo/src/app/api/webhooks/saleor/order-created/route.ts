import { captureException } from "@sentry/nextjs";

import type { OrderForShippoFragment } from "@/generated/graphql";
import { createAuthenticatedGraphQLClient } from "@/lib/graphql-client";
import { createLogger } from "@/lib/logger";
import { withLoggerContext } from "@/lib/logger-context";
import { appConfigRepoImpl } from "@/modules/app-config/repositories/app-config-repo-impl";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { SaleorGateway } from "@/modules/saleor/saleor-gateway";
import { buildShippoClient } from "@/modules/use-cases/build-client";
import { orderLinkStore } from "@/modules/use-cases/factories";
import { PushOrderToShippoUseCase } from "@/modules/use-cases/push-order-to-shippo";
import { computeTotalWeightOunces } from "@/modules/use-cases/weight-calculator";

import { orderCreatedWebhookDefinition } from "./webhook-definition";

const FALLBACK_LINE_WEIGHT_OZ = 8;

const logger = createLogger("OrderCreated route");

function getOrderFromOrderCreatedPayload(payload: unknown): OrderForShippoFragment | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const top = payload as { order?: OrderForShippoFragment; event?: { order?: OrderForShippoFragment } };

  return top.order ?? top.event?.order;
}

const useCase = new PushOrderToShippoUseCase({
  configRepo: appConfigRepoImpl,
  buildShippoClient: (config) => buildShippoClient(config, { timeoutMs: 25_000 }),
  buildSaleorGateway: ({ saleorApiUrl, token }) =>
    new SaleorGateway(createAuthenticatedGraphQLClient({ saleorApiUrl, token })),
  orderLinkStore: orderLinkStore(),
});

const handler = orderCreatedWebhookDefinition.createHandler(async (_req, ctx) => {
  try {
    const saleorApiUrlResult = createSaleorApiUrl(ctx.authData.saleorApiUrl);

    if (saleorApiUrlResult.isErr()) {
      logger.warn("Invalid saleorApiUrl", { saleorApiUrl: ctx.authData.saleorApiUrl });

      return Response.json({ ok: false }, { status: 400 });
    }

    const order = getOrderFromOrderCreatedPayload(ctx.payload);

    logger.info("ORDER_CREATED received", {
      hasOrder: Boolean(order),
      orderId: order?.id ?? null,
      orderNumber: order?.number ?? null,
      payloadTopKeys:
        ctx.payload && typeof ctx.payload === "object"
          ? Object.keys(ctx.payload as object)
          : [],
    });

    if (!order) {
      logger.warn("No order in webhook payload", {
        topKeys: ctx.payload && typeof ctx.payload === "object" ? Object.keys(ctx.payload as object) : [],
      });

      return Response.json({ ok: true }, { status: 200 });
    }

    const delivery =
      order.deliveryMethod && order.deliveryMethod.__typename === "ShippingMethod"
        ? order.deliveryMethod
        : null;

    const totalWeightOunces = computeTotalWeightOunces(
      order.lines.map((l) => ({
        quantity: l.quantity,
        unitWeightValue: l.variant?.weight?.value ?? null,
        unitWeightUnit: l.variant?.weight?.unit ?? null,
      })),
      FALLBACK_LINE_WEIGHT_OZ,
    );

    const subtotal = order.subtotal?.gross.amount ?? 0;
    const total = order.total.gross.amount;
    const tax =
      order.total.tax?.amount ??
      Math.max(0, total - subtotal - (order.shippingPrice?.gross.amount ?? 0));
    const shippingCost = order.shippingPrice?.gross.amount ?? 0;
    const currency = order.total.gross.currency;

    const result = await useCase.execute(
      {
        saleorApiUrl: saleorApiUrlResult.value,
        appId: ctx.authData.appId,
        order: {
          id: order.id,
          number: order.number,
          createdAt: order.created,
          channelSlug: order.channel.slug,
          channelCurrency: order.channel.currencyCode,
          email: order.userEmail ?? null,
          total,
          subtotal,
          tax,
          shippingCost,
          currency,
          totalWeightOunces,
          shippingMethodId: delivery?.id ?? null,
          shippingMethodName: delivery?.name ?? null,
          shippingAddress: order.shippingAddress
            ? {
                firstName: order.shippingAddress.firstName,
                lastName: order.shippingAddress.lastName,
                companyName: order.shippingAddress.companyName,
                streetAddress1: order.shippingAddress.streetAddress1,
                streetAddress2: order.shippingAddress.streetAddress2,
                city: order.shippingAddress.city,
                postalCode: order.shippingAddress.postalCode,
                countryArea: order.shippingAddress.countryArea,
                countryCode: order.shippingAddress.country.code,
                phone: order.shippingAddress.phone ?? null,
              }
            : null,
          billingAddress: order.billingAddress
            ? {
                firstName: order.billingAddress.firstName,
                lastName: order.billingAddress.lastName,
                companyName: order.billingAddress.companyName,
                streetAddress1: order.billingAddress.streetAddress1,
                streetAddress2: order.billingAddress.streetAddress2,
                city: order.billingAddress.city,
                postalCode: order.billingAddress.postalCode,
                countryArea: order.billingAddress.countryArea,
                countryCode: order.billingAddress.country.code,
                phone: order.billingAddress.phone ?? null,
              }
            : null,
          lines: order.lines.map((l) => ({
            name: l.productName,
            sku: l.productSku ?? null,
            quantity: l.quantity,
            unitPrice: l.unitPrice.gross.amount,
            totalPrice: l.totalPrice.gross.amount,
            unitWeightOunces: computeTotalWeightOunces(
              [
                {
                  quantity: 1,
                  unitWeightValue: l.variant?.weight?.value ?? null,
                  unitWeightUnit: l.variant?.weight?.unit ?? null,
                },
              ],
              FALLBACK_LINE_WEIGHT_OZ,
            ),
          })),
        },
      },
      { saleorApiUrl: ctx.authData.saleorApiUrl, token: ctx.authData.token },
    );

    if (result.isErr()) {
      logger.warn("Push order to Shippo failed", { error: result.error.message });
      if (result.error._internalName === "PushOrderError.NotConfigured") {
        return Response.json({ ok: true, skipped: true }, { status: 200 });
      }

      return Response.json({ ok: false, message: result.error.message }, { status: 500 });
    }

    return Response.json({ ok: true, ...result.value }, { status: 200 });
  } catch (error) {
    captureException(error);
    logger.error("Unhandled error in ORDER_CREATED", {
      message: (error as Error).message,
    });

    return Response.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
});

export const POST = withLoggerContext(handler);
