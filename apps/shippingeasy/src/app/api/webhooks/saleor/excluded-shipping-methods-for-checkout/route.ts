import { createLogger } from "@/lib/logger";
import { withLoggerContext } from "@/lib/logger-context";

import { excludedShippingMethodsForCheckoutWebhookDefinition } from "./webhook-definition";

const logger = createLogger("ExcludedShippingMethodsForCheckout route");

/**
 * This handler is registered but disabled by default; merchants can enable it
 * when they want the ShippingEasy app to filter native Saleor shipping
 * methods. By default we exclude nothing.
 */
const handler = excludedShippingMethodsForCheckoutWebhookDefinition.createHandler(
  async (_req, _ctx) => {
    logger.debug("ExcludedShippingMethodsForCheckout called, returning empty list");

    return Response.json({ excluded_methods: [] }, { status: 200 });
  },
);

export const POST = withLoggerContext(handler);
