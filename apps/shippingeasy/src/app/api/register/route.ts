import { createAppRegisterHandler } from "@saleor/app-sdk/handlers/next-app-router";
import { captureException } from "@sentry/nextjs";

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { withLoggerContext } from "@/lib/logger-context";
import { saleorApp } from "@/lib/saleor-app";

const logger = createLogger("registerHandler");

const serializeAplError = (err: unknown) => {
  if (err instanceof Error) {
    const e = err as Error & { name?: string; $metadata?: { httpStatusCode?: number } };

    return {
      name: e.name,
      message: e.message,
      httpStatusCode: e.$metadata?.httpStatusCode,
    };
  }

  return { message: String(err) };
};

const allowedUrlsPattern = env.ALLOWED_DOMAIN_PATTERN;

const handler = createAppRegisterHandler({
  apl: saleorApp.apl,
  allowedSaleorUrls: [
    (url) => {
      if (!allowedUrlsPattern) return true;
      const regex = new RegExp(allowedUrlsPattern);
      const ok = regex.test(url);

      if (!ok) logger.warn("Blocked installation from disallowed Saleor", { saleorApiUrl: url });

      return ok;
    },
  ],
  onAplSetFailed: async (_req, context) => {
    const details = serializeAplError(context.error);

    logger.error("Failed to set APL (DynamoDB PutItem / APL.set)", {
      saleorApiUrl: context.authData.saleorApiUrl,
      dynamoTable: env.DYNAMODB_MAIN_TABLE_NAME ?? "(fallback shippingeasy-app-main)",
      awsRegion: env.AWS_REGION ?? "(default chain)",
      ...details,
    });
    captureException(context.error, {
      tags: { saleorApiUrl: context.authData.saleorApiUrl },
      extra: { dynamoTable: env.DYNAMODB_MAIN_TABLE_NAME, ...details },
    });
  },
  onAuthAplSaved: async (_req, context) => {
    logger.info("App installation saved", { saleorApiUrl: context.authData.saleorApiUrl });
  },
});

export const POST = withLoggerContext(handler);
