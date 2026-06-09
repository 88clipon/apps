import { SALEOR_API_URL_HEADER, SALEOR_AUTHORIZATION_BEARER_HEADER } from "@saleor/app-sdk/headers";
import { httpBatchLink } from "@trpc/client";
import { createTRPCNext } from "@trpc/next";

import { appBridgeInstance } from "@/pages/_app";

import type { AppRouter } from "./trpc-app-router";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";

  return "";
}

export const trpcClient = createTRPCNext<AppRouter>({
  config() {
    return {
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          headers() {
            return {
               
              [SALEOR_AUTHORIZATION_BEARER_HEADER]: appBridgeInstance?.getState().token ?? "",
              [SALEOR_API_URL_HEADER]: appBridgeInstance?.getState().saleorApiUrl ?? "",
               
            };
          },
        }),
      ],
      queryClientConfig: {
        defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
      },
    };
  },
  ssr: false,
});
