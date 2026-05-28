import { z } from "zod";

import { appConfigSchema, smtpConfigSchema } from "@/modules/app-config/domain/app-config";

/** Save the full app config in one shot — simpler than per-field mutations. */
export const saveConfigInputSchema = appConfigSchema;

/** SMTP creds + destination address for the "send test email" button. */
export const sendTestEmailInputSchema = smtpConfigSchema.extend({
  to: z.string().email(),
});
