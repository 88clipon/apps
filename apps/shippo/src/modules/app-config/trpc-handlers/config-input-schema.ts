import { z } from "zod";

import {
  emailsHandledBySchema,
  originAddressSchema,
  packageDefaultsSchema,
  rateMarkupSchema,
} from "@/modules/app-config/domain/shippo-app-config";

export const saveConfigInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    // When `id` is set this is an EDIT — the field may be left blank and
    // the existing token will be preserved server-side. For new configs the
    // token is required; that check lives in the save handler so the schema
    // itself stays simple to share with the UI form types.
    shippoApiToken: z.string().optional().default(""),
    webhookSecret: z.string().optional().default(""),
    autoPurchaseLabel: z.boolean().optional().default(false),
    labelFileType: z.enum(["PDF", "PDF_4x6", "PNG", "ZPLII"]).optional().default("PDF_4x6"),
    originAddress: originAddressSchema,
    packageDefaults: packageDefaultsSchema,
    domesticServices: z.array(z.string()).optional().default([]),
    internationalServices: z.array(z.string()).optional().default([]),
    rateMarkup: rateMarkupSchema,
    emailsHandledBy: emailsHandledBySchema,
  })
  .superRefine((value, ctx) => {
    if (!value.id && !value.shippoApiToken) {
      ctx.addIssue({
        path: ["shippoApiToken"],
        code: z.ZodIssueCode.custom,
        message: "Shippo API token is required",
      });
    }
  });
export type SaveConfigInput = z.infer<typeof saveConfigInputSchema>;

export const removeConfigInputSchema = z.object({
  configId: z.string().min(1),
});

export const updateMappingInputSchema = z.object({
  channelSlug: z.string().min(1),
  configId: z.string().min(1).nullable(),
});

export const testConnectionInputSchema = z.object({
  shippoApiToken: z.string().min(1),
});
