import { z } from "zod";

import {
  emailsHandledBySchema,
  originAddressSchema,
  packageDefaultsSchema,
  rateMarkupSchema,
  shippingEasyCarrierSchema,
} from "@/modules/app-config/domain/shippingeasy-config";

/** ShippingEasy store IDs are numeric; coerce so JSON numbers still validate. */
const storeIdSchema = z.preprocess(
  (v) => {
    if (v == null) return "";
    if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));

    return String(v).trim();
  },
  z
    .string()
    .min(1, "Store ID is required (numeric ID from ShippingEasy → Settings → Stores & Orders / API store)."),
);

export const saveConfigInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  storeId: storeIdSchema,
  webhookSecret: z.string().optional(),
  shippoApiToken: z.string().optional().default(""),
  originAddress: originAddressSchema,
  packageDefaults: packageDefaultsSchema,
  enabledCarriers: z.array(shippingEasyCarrierSchema).min(1),
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
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  storeId: storeIdSchema,
});
