import { captureException } from "@sentry/nextjs";

import { createAuthenticatedGraphQLClient } from "@/lib/graphql-client";
import { createLogger } from "@/lib/logger";
import { withLoggerContext } from "@/lib/logger-context";
import { appConfigRepoImpl } from "@/modules/app-config/repositories/app-config-repo-impl";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { SaleorGateway } from "@/modules/saleor/saleor-gateway";
import { buildShippingEasyClient } from "@/modules/use-cases/build-client";
import { orderLinkStore } from "@/modules/use-cases/factories";
import { PushOrderToShippingEasyUseCase } from "@/modules/use-cases/push-order-to-shippingeasy";

import { orderCreatedWebhookDefinition } from "./webhook-definition";

const logger = createLogger("OrderCreated route");

const useCase = new PushOrderToShippingEasyUseCase({
  configRepo: appConfigRepoImpl,
  buildClient: buildShippingEasyClient,
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

    const order = ctx.payload.event?.order;

    if (!order) {
      logger.warn("No order payload");

      return Response.json({ ok: true }, { status: 200 });
    }

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
          email: order.userEmail,
          total: order.total.gross.amount,
          currency: order.total.gross.currency,
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
                phone: order.shippingAddress.phone,
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
                phone: order.billingAddress.phone,
              }
            : null,
          lines: order.lines.map((l) => ({
            name: l.productName,
            sku: l.productSku,
            quantity: l.quantity,
            unitPrice: l.unitPrice.gross.amount,
          })),
        },
      },
      { saleorApiUrl: ctx.authData.saleorApiUrl, token: ctx.authData.token },
    );

    if (result.isErr()) {
      logger.warn("Push order failed", { error: result.error.message });
      /**
       * We return 200 on "not configured" so Saleor doesn't retry forever when
       * the channel simply isn't mapped. Only true upstream/metadata failures
       * get a 5xx so Saleor retries.
       */
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
