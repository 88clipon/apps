import { verifyJWT } from "@saleor/app-sdk/auth";
import { REQUIRED_SALEOR_PERMISSIONS } from "@saleor/apps-shared/permissions";
import { TRPCError } from "@trpc/server";

import { createLogger } from "@/lib/logger";
import { saleorApp } from "@/lib/saleor-app";

import { middleware, procedure } from "./trpc-server";

const logger = createLogger("protectedClientProcedure");

const attachAppToken = middleware(async ({ ctx, next }) => {
  const { saleorApiUrl } = ctx;

  if (!saleorApiUrl) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Missing saleorApiUrl in request" });
  }

  const authData = await saleorApp.apl.get(saleorApiUrl);

  if (!authData) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Missing auth data" });
  }

  return next({
    ctx: {
      appToken: authData.token,
      saleorApiUrl: authData.saleorApiUrl,
      appId: authData.appId,
    },
  });
});

const validateClientToken = middleware(async ({ ctx, next, meta }) => {
  if (!ctx.token) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Missing token in request",
    });
  }
  if (!ctx.appId || !ctx.saleorApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Missing auth context",
    });
  }

  try {
    await verifyJWT({
      appId: ctx.appId,
      token: ctx.token,
      saleorApiUrl: ctx.saleorApiUrl,
      requiredPermissions: [
        ...REQUIRED_SALEOR_PERMISSIONS,
        ...(meta?.requiredClientPermissions ?? []),
      ],
    });
  } catch (e) {
    logger.debug("JWT verification failed", { error: e });
    throw new TRPCError({ code: "UNAUTHORIZED", message: "JWT verification failed" });
  }

  return next({ ctx: { ...ctx, saleorApiUrl: ctx.saleorApiUrl } });
});

export const protectedClientProcedure = procedure.use(attachAppToken).use(validateClientToken);
