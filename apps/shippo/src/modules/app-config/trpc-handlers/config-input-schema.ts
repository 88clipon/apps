import { z } from "zod";

import {
  emailsHandledBySchema,
  originAddressSchema,
  packageDefaultsSchema,
  rateMarkupSchema,
} from "@/modules/app-config/domain/shippo-app-config";

export const saveConfigInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  shippoApiToken: z.string().min(1, "Shippo API token is required"),
  webhookSecret: z.string().optional().default(""),
  autoPurchaseLabel: z.boolean().optional().default(false),
  labelFileType: z.enum(["PDF", "PDF_4x6", "PNG", "ZPLII"]).optional().default("PDF_4x6"),
  originAddress: originAddressSchema,
  packageDefaults: packageDefaultsSchema,
  domesticServices: z.array(z.string()).optional().default([]),
  internationalServices: z.array(z.string()).optional().default([]),
  rateMarkup: rateMarkupSchema,
  emailsHandledBy: emailsHandledBySchema,
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
