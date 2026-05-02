import { env } from "@/lib/env";
import { ShippingEasyConfig } from "@/modules/app-config/domain/shippingeasy-config";
import { ShippingEasyClient } from "@/modules/shippingeasy/shippingeasy-client";
import { ShippoClient } from "@/modules/shippo/shippo-client";

/**
 * Factory that creates a ShippingEasyClient from a stored config. Used for
 * order management (create/cancel orders).
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

/**
 * Factory that creates a ShippoClient for real-time rate quotes at checkout.
 * Returns null if no Shippo API token is configured, in which case the rate
 * lookup use case will return an empty list (no rates shown).
 */
export const buildShippoClient = (
  config: ShippingEasyConfig,
  opts?: { timeoutMs?: number },
): ShippoClient | null => {
  if (!config.shippoApiToken) return null;

  return new ShippoClient({
    apiToken: config.shippoApiToken,
    timeoutMs: opts?.timeoutMs,
  });
};
