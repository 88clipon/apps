import { z } from "zod";

import {
  emailsHandledBySchema,
  originAddressSchema,
  packageDefaultsSchema,
  rateMarkupSchema,
  shippingEasyCarrierSchema,
} from "@/modules/app-config/domain/shippingeasy-config";

export const saveConfigInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  storeId: z.string().min(1),
  webhookSecret: z.string().optional(),
  originAddress: originAddressSchema,
  packageDefaults: packageDefaultsSchema,
  enabledCarriers: z.array(shippingEasyCarrierSchema).min(1),
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
  storeId: z.string().min(1),
});
