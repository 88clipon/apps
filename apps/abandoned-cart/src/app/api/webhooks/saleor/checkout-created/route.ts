import { captureException } from "@sentry/nextjs";

import { createLogger } from "@/lib/logger";
import { withLoggerContext } from "@/lib/logger-context";
import { repoImpl } from "@/modules/app-config/repositories/repo-impl";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { TrackCheckoutUseCase } from "@/modules/use-cases/track-checkout";

import { checkoutCreatedWebhookDefinition } from "./webhook-definition";

const logger = createLogger("CheckoutCreated route");
const useCase = new TrackCheckoutUseCase(repoImpl);

const handler = checkoutCreatedWebhookDefinition.createHandler(async (_req, ctx) => {
  try {
    const apiUrl = createSaleorApiUrl(ctx.authData.saleorApiUrl);

    if (apiUrl.isErr()) {
      return Response.json({ ok: false }, { status: 400 });
    }

    const result = await useCase.execute({
      access: { saleorApiUrl: apiUrl.value, appId: ctx.authData.appId },
      payload: (ctx.payload as { event?: unknown }).event ?? ctx.payload,
    });

    if (result.isErr()) {
      logger.error("Track checkout failed", { error: result.error });
      captureException(result.error);

      return Response.json({ ok: false }, { status: 500 });
    }

    return Response.json({ ok: true, ...result.value });
  } catch (error) {
    logger.error("CHECKOUT_CREATED handler threw", { message: String(error) });
    captureException(error);

    return Response.json({ ok: false }, { status: 500 });
  }
});

export const POST = withLoggerContext(handler);
