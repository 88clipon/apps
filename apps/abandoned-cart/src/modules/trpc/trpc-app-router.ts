import { configRouter } from "@/modules/app-config/trpc-handlers/config-router";

import { router } from "./trpc-server";

export const appRouter = router({
  config: configRouter,
});

export type AppRouter = typeof appRouter;
