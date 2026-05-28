import { captureException } from "@sentry/nextjs";

import { createLogger } from "@/lib/logger";
import { withLoggerContext } from "@/lib/logger-context";
import { repoImpl } from "@/modules/app-config/repositories/repo-impl";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { MarkRecoveredUseCase } from "@/modules/use-cases/mark-recovered";

import { orderCreatedWebhookDefinition } from "./webhook-definition";

const logger = createLogger("AbandonedCartOrderCreated route");
const useCase = new MarkRecoveredUseCase(repoImpl);

const handler = orderCreatedWebhookDefinition.createHandler(async (_req, ctx) => {
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
      logger.error("Mark recovered failed", { error: result.error });
      captureException(result.error);

      return Response.json({ ok: false }, { status: 500 });
    }

    return Response.json({ ok: true, ...result.value });
  } catch (error) {
    logger.error("ORDER_CREATED handler threw", { message: String(error) });
    captureException(error);

    return Response.json({ ok: false }, { status: 500 });
  }
});

export const POST = withLoggerContext(handler);
