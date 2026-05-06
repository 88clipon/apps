import { env } from "@/lib/env";
import { ShippoAppConfig } from "@/modules/app-config/domain/shippo-app-config";
import { ShippoClient } from "@/modules/shippo/shippo-client";

/**
 * Factory that creates a ShippoClient from a stored config. Uses the per-config
 * token first; falls back to the SHIPPO_API_TOKEN env var. Returns null if no
 * token is available, in which case rate lookup / label purchase degrades gracefully.
 */
export const buildShippoClient = (
  config: ShippoAppConfig,
  opts?: { timeoutMs?: number },
): ShippoClient | null => {
  const token = config.shippoApiToken || env.SHIPPO_API_TOKEN;

  if (!token) return null;

  return new ShippoClient({
    apiToken: token,
    timeoutMs: opts?.timeoutMs,
  });
};
