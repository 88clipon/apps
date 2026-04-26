import { createAppRegisterHandler } from "@saleor/app-sdk/handlers/next-app-router";

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { withLoggerContext } from "@/lib/logger-context";
import { saleorApp } from "@/lib/saleor-app";

const logger = createLogger("registerHandler");

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
    logger.error("Failed to set APL", {
      saleorApiUrl: context.authData.saleorApiUrl,
      error: context.error,
    });
  },
  onAuthAplSaved: async (_req, context) => {
    logger.info("App installation saved", { saleorApiUrl: context.authData.saleorApiUrl });
  },
});

export const POST = withLoggerContext(handler);
