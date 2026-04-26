import { env } from "@/lib/env";
import { ShippingEasyConfig } from "@/modules/app-config/domain/shippingeasy-config";
import { ShippingEasyClient } from "@/modules/shippingeasy/shippingeasy-client";

/**
 * Factory that creates a ShippingEasyClient from a stored config. Kept in a
 * single place so all use cases use the same base URL and timeout defaults.
 */
export const buildShippingEasyClient = (
  config: ShippingEasyConfig,
  opts?: { timeoutMs?: number },
): ShippingEasyClient => {
  return new ShippingEasyClient({
    baseUrl: env.SHIPPINGEASY_API_BASE_URL,
    credentials: {
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      storeId: config.storeId,
    },
    timeoutMs: opts?.timeoutMs,
  });
};
