import { attachLoggerConsoleTransport, rootLogger } from "@saleor/apps-logger";

rootLogger.settings.maskValuesOfKeys = ["token", "apiKey", "apiSecret", "secretKey"];

attachLoggerConsoleTransport(rootLogger);

export const createLogger = (name: string, params?: Record<string, unknown>) =>
  rootLogger.getSubLogger(
    {
      name: name,
    },
    params,
  );
