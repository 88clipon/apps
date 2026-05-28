import { TRPCError } from "@trpc/server";

import { createLogger } from "@/lib/logger";
import { AppConfig } from "@/modules/app-config/domain/app-config";
import { repoImpl } from "@/modules/app-config/repositories/repo-impl";
import { emailSender } from "@/modules/email/email-sender";
import { buildContext, renderTemplate } from "@/modules/email/template-renderer";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { ProcessRemindersUseCase } from "@/modules/scheduler/process-reminders";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

import { saveConfigInputSchema, sendTestEmailInputSchema } from "./config-input-schema";

const logger = createLogger("ConfigRouter");

const unwrapSaleorApiUrl = (raw: string) => {
  const r = createSaleorApiUrl(raw);

  if (r.isErr()) throw new TRPCError({ code: "BAD_REQUEST", message: r.error.message });

  return r.value;
};

const requireCtx = (ctx: { saleorApiUrl?: string; appId?: string }) => {
  if (!ctx.appId)
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Missing appId" });
  if (!ctx.saleorApiUrl)
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Missing saleorApiUrl" });

  return { appId: ctx.appId, saleorApiUrl: ctx.saleorApiUrl };
};

/**
 * Mask the SMTP password before returning to the UI. The merchant can leave
 * the field blank on save to keep the stored value, just like Shippo's
 * API-token preservation.
 */
const maskConfig = (config: AppConfig) => {
  const json = config.toJSON();

  return {
    ...json,
    smtp: json.smtp
      ? { ...json.smtp, password: json.smtp.password ? "********" : "" }
      : undefined,
  };
};

export const configRouter = router({
  get: protectedClientProcedure
    .meta({ requiredClientPermissions: ["MANAGE_APPS"] })
    .query(async ({ ctx }) => {
      const { appId } = requireCtx(ctx);
      const saleorApiUrl = unwrapSaleorApiUrl(ctx.saleorApiUrl);

      const result = await repoImpl.getConfig({ saleorApiUrl, appId });

      if (result.isErr()) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error.message,
        });
      }

      return result.value ? maskConfig(result.value) : null;
    }),

  save: protectedClientProcedure
    .meta({ requiredClientPermissions: ["MANAGE_APPS"] })
    .input(saveConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { appId } = requireCtx(ctx);
      const saleorApiUrl = unwrapSaleorApiUrl(ctx.saleorApiUrl);

      // Preserve existing SMTP password if the form sent the mask back.
      let smtp = input.smtp;

      if (smtp && smtp.password === "********") {
        const existing = await repoImpl.getConfig({ saleorApiUrl, appId });

        if (existing.isOk() && existing.value?.smtp) {
          smtp = { ...smtp, password: existing.value.smtp.password };
        }
      }

      const configResult = AppConfig.create({ ...input, smtp });

      if (configResult.isErr()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: configResult.error.message });
      }

      const saveResult = await repoImpl.saveConfig({
        access: { saleorApiUrl, appId },
        config: configResult.value,
      });

      if (saveResult.isErr()) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: saveResult.error.message,
        });
      }

      logger.info("App config saved", {
        programs: configResult.value.programs.length,
        hasSmtp: !!configResult.value.smtp,
      });

      return { ok: true as const };
    }),

  /**
   * Render a sample email against the saved config — lets the merchant preview
   * a template without an actual abandoned cart.
   */
  previewTemplate: protectedClientProcedure
    .meta({ requiredClientPermissions: ["MANAGE_APPS"] })
    .input(saveConfigInputSchema.pick({ programs: true, storeName: true, storefrontUrl: true }))
    .mutation(({ input }) => {
      const reminder = input.programs[0]?.reminders[0];

      if (!reminder) throw new TRPCError({ code: "BAD_REQUEST", message: "No reminder to preview" });

      // Synthetic context — represents a typical cart.
      const sampleContext = buildContext({
        cart: {
          checkoutId: "preview-abc123",
          saleorApiUrl: "preview" as never,
          appId: "preview",
          channelSlug: input.programs[0]?.channelSlug ?? "default-channel",
          email: "buyer@example.com",
          customerFirstName: "Alex",
          customerLastName: "Buyer",
          totalAmount: 49.98,
          currency: "USD",
          lines: [
            { name: "Sample sunglasses 50X20", quantity: 1, unitPrice: 49.98 },
          ],
          lastUpdatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          remindersSent: [],
          recoveredAt: null,
          unsubscribedAt: null,
          ttl: 0,
          isLive: true,
        } as never,
        storefrontUrl: input.storefrontUrl,
        storeName: input.storeName,
      });

      return {
        subject: renderTemplate(reminder.subject, sampleContext),
        bodyHtml: renderTemplate(reminder.bodyHtml, sampleContext),
      };
    }),

  /**
   * Verify SMTP credentials by sending a one-line "you're configured" email
   * to the address the merchant provides. Doesn't touch the saved config.
   */
  sendTestEmail: protectedClientProcedure
    .meta({ requiredClientPermissions: ["MANAGE_APPS"] })
    .input(sendTestEmailInputSchema)
    .mutation(async ({ input }) => {
      const { to, ...smtp } = input;
      const result = await emailSender.send({
        config: smtp,
        email: {
          to,
          subject: "Abandoned cart app — SMTP test",
          html: "<p>If you received this, the SMTP credentials are valid.</p>",
        },
      });

      if (result.isErr()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `SMTP send failed: ${result.error.message}`,
        });
      }

      return { ok: true as const, messageId: result.value.messageId };
    }),

  /**
   * Manually trigger one scheduler pass for this tenant. Useful for testing
   * "is my template + cron working" without waiting for a real abandoned cart.
   */
  runOnce: protectedClientProcedure
    .meta({ requiredClientPermissions: ["MANAGE_APPS"] })
    .mutation(async ({ ctx }) => {
      const { appId } = requireCtx(ctx);
      const saleorApiUrl = unwrapSaleorApiUrl(ctx.saleorApiUrl);
      const useCase = new ProcessRemindersUseCase(repoImpl, emailSender);
      const result = await useCase.execute({ saleorApiUrl, appId });

      if (result.isErr()) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error.message,
        });
      }

      return result.value;
    }),
});
