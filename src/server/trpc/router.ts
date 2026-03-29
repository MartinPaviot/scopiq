import { router, publicProcedure } from "./trpc";

export const appRouter = router({
  // Placeholder — routers added in Phase C
  ping: publicProcedure.query(() => "pong"),
});

export type AppRouter = typeof appRouter;
