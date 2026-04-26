import { attachLoggerConsoleTransport, rootLogger } from "@saleor/apps-logger";

import { env } from "./env";

rootLogger.settings.maskValuesOfKeys = ["token", "apiKey", "apiSecret", "secretKey"];

if (env.NODE_ENV === "development") {
  attachLoggerConsoleTransport(rootLogger);
}

export const createLogger = (name: string, params?: Record<string, unknown>) =>
  rootLogger.getSubLogger(
    {
      name: name,
    },
    params,
  );
