import { captureException } from "@sentry/nextjs";

import type { ShippingListMethodsCheckoutFragment } from "@/generated/graphql";
import { createLogger } from "@/lib/logger";
import { withLoggerContext } from "@/lib/logger-context";
import { appConfigRepoImpl } from "@/modules/app-config/repositories/app-config-repo-impl";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { buildShippoClient } from "@/modules/use-cases/build-client";
import { ListShippingRatesUseCase } from "@/modules/use-cases/list-shipping-rates";
import { InMemoryRateCache } from "@/modules/use-cases/rate-cache";
import { computeTotalWeightOunces } from "@/modules/use-cases/weight-calculator";

import { shippingListMethodsForCheckoutWebhookDefinition } from "./webhook-definition";

type ShippingListMethodsCheckout = ShippingListMethodsCheckoutFragment;

function getCheckoutFromSyncPayload(
  payload: unknown,
): ShippingListMethodsCheckout | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const p = payload as {
    checkout?: ShippingListMethodsCheckout;
    event?: { checkout?: ShippingListMethodsCheckout };
  };

  return p.checkout ?? p.event?.checkout;
}

const logger = createLogger("Shippo list methods for checkout");

/**
 * A process-wide cache is good enough for a single serverless instance; in
 * production the DynamoDB cache can be swapped in via buildRateCache().
 */
const rateCache = new InMemoryRateCache();

const useCase = new ListShippingRatesUseCase({
  configRepo: appConfigRepoImpl,
  rateCache,
  buildShippoClient: (config) => buildShippoClient(config, { timeoutMs: 5_000 }),
});

const handler = shippingListMethodsForCheckoutWebhookDefinition.createHandler(async (_req, ctx) => {
  try {
    const saleorApiUrlResult = createSaleorApiUrl(ctx.authData.saleorApiUrl);

    if (saleorApiUrlResult.isErr()) {
      logger.warn("Invalid saleorApiUrl in webhook auth; cannot load app config", {
        saleorApiUrl: ctx.authData.saleorApiUrl,
      });

      return Response.json([], { status: 200 });
    }

    const checkout = getCheckoutFromSyncPayload(ctx.payload);

    if (!checkout) {
      logger.warn("No checkout in payload");

      return Response.json([], { status: 200 });
    }

    const lines = checkout.lines.map((l) => ({
      quantity: l.quantity,
      unitWeightValue:
        l.variant.weight?.value ?? l.variant.product?.weight?.value ?? null,
      unitWeightUnit: l.variant.weight?.unit ?? l.variant.product?.weight?.unit ?? null,
    }));

    const totalWeightOunces = computeTotalWeightOunces(lines, 8);

    const result = await useCase.execute({
      saleorApiUrl: saleorApiUrlResult.value,
      appId: ctx.authData.appId,
      channelSlug: checkout.channel.slug,
      shippingAddress: checkout.shippingAddress
        ? {
            firstName: checkout.shippingAddress.firstName,
            lastName: checkout.shippingAddress.lastName,
            companyName: checkout.shippingAddress.companyName,
            streetAddress1: checkout.shippingAddress.streetAddress1,
            streetAddress2: checkout.shippingAddress.streetAddress2,
            city: checkout.shippingAddress.city,
            postalCode: checkout.shippingAddress.postalCode,
            countryArea: checkout.shippingAddress.countryArea,
            countryCode: checkout.shippingAddress.country.code,
            phone: checkout.shippingAddress.phone,
          }
        : null,
      totalWeightOunces,
    });

    if (result.isErr()) {
      logger.warn("ListShippingRates use case returned error", { error: result.error });

      return Response.json([], { status: 200 });
    }

    logger.info("Returning shipping methods", {
      count: result.value.length,
      methods: result.value.map((m) => m.name),
    });

    return Response.json(result.value, { status: 200 });
  } catch (error) {
    captureException(error);
    logger.error("Unhandled error in SHIPPING_LIST_METHODS_FOR_CHECKOUT", {
      message: (error as Error).message,
    });

    return Response.json([], { status: 200 });
  }
});

export const POST = withLoggerContext(handler);
