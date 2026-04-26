import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { ShippingEasyConfig, ShippingEasyFrontendConfig } from "@/modules/app-config/domain/shippingeasy-config";
import { appConfigRepoImpl } from "@/modules/app-config/repositories/app-config-repo-impl";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { ShippingEasyClient } from "@/modules/shippingeasy/shippingeasy-client";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

import {
  removeConfigInputSchema,
  saveConfigInputSchema,
  testConnectionInputSchema,
  updateMappingInputSchema,
} from "./config-input-schema";

const logger = createLogger("ConfigRouter");

const unwrapSaleorApiUrl = (raw: string) => {
  const r = createSaleorApiUrl(raw);

  if (r.isErr()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: r.error.message });
  }

  return r.value;
};

/** `protectedClientProcedure` sets these at runtime; narrow for TypeScript. */
const requireInstalledAppContext = (ctx: { saleorApiUrl?: string; appId?: string }) => {
  if (!ctx.appId) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Missing appId" });
  }
  if (!ctx.saleorApiUrl) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Missing saleorApiUrl" });
  }

  return { appId: ctx.appId, saleorApiUrl: ctx.saleorApiUrl };
};

export const configRouter = router({
  getAll: protectedClientProcedure
    .meta({ requiredClientPermissions: ["MANAGE_APPS"] })
    .query(async ({ ctx }) => {
      const { appId } = requireInstalledAppContext(ctx);
      const saleorApiUrl = unwrapSaleorApiUrl(ctx.saleorApiUrl);

      const rootResult = await appConfigRepoImpl.getRootConfig({
        saleorApiUrl,
        appId,
      });

      if (rootResult.isErr()) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: rootResult.error.message });
      }

      return {
        configs: Array.from(rootResult.value.configs.values()).map((c) =>
          ShippingEasyFrontendConfig.fromConfig(c),
        ),
        channelMapping: Object.fromEntries(rootResult.value.channelMapping),
      };
    }),

  save: protectedClientProcedure
    .meta({ requiredClientPermissions: ["MANAGE_APPS"] })
    .input(saveConfigInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { appId } = requireInstalledAppContext(ctx);
      const saleorApiUrl = unwrapSaleorApiUrl(ctx.saleorApiUrl);

      const configId = input.id ?? randomUUID();
      const configResult = ShippingEasyConfig.create({ ...input, id: configId });

      if (configResult.isErr()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: configResult.error.message });
      }

      const saved = await appConfigRepoImpl.saveConfig({
        config: configResult.value,
        saleorApiUrl,
        appId,
      });

      if (saved.isErr()) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: saved.error.message });
      }

      logger.info("Config saved", { configId });

      return { id: configId };
    }),

  remove: protectedClientProcedure
    .meta({ requiredClientPermissions: ["MANAGE_APPS"] })
    .input(removeConfigInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { appId } = requireInstalledAppContext(ctx);
      const saleorApiUrl = unwrapSaleorApiUrl(ctx.saleorApiUrl);

      const r = await appConfigRepoImpl.removeConfig(
        { saleorApiUrl, appId },
        { configId: input.configId },
      );

      if (r.isErr()) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: r.error.message });
      }

      return { ok: true };
    }),

  updateMapping: protectedClientProcedure
    .meta({ requiredClientPermissions: ["MANAGE_APPS"] })
    .input(updateMappingInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { appId } = requireInstalledAppContext(ctx);
      const saleorApiUrl = unwrapSaleorApiUrl(ctx.saleorApiUrl);

      const r = await appConfigRepoImpl.updateChannelMapping(
        { saleorApiUrl, appId },
        { channelSlug: input.channelSlug, configId: input.configId },
      );

      if (r.isErr()) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: r.error.message });
      }

      return { ok: true };
    }),

  testConnection: protectedClientProcedure
    .meta({ requiredClientPermissions: ["MANAGE_APPS"] })
    .input(testConnectionInputSchema)
    .mutation(async ({ input }) => {
      const client = new ShippingEasyClient({
        baseUrl: env.SHIPPINGEASY_API_BASE_URL,
        credentials: {
          apiKey: input.apiKey,
          apiSecret: input.apiSecret,
          storeId: input.storeId,
        },
        timeoutMs: 8_000,
      });

      const result = await client.listStores();

      if (result.isErr()) {
        return { ok: false as const, message: result.error.message };
      }

      const hasStore = result.value.stores.some((s) => s.id === input.storeId);

      return {
        ok: true as const,
        storeMatch: hasStore,
        stores: result.value.stores.map((s) => ({ id: s.id, name: s.name ?? "" })),
      };
    }),
});
