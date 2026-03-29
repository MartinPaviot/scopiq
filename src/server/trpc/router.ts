import { router } from "./trpc";
import { workspaceRouter } from "./routers/workspace";
import { ingestionRouter } from "./routers/ingestion";
import { icpRouter } from "./routers/icp";
import { tamRouter } from "./routers/tam";
import { integrationRouter } from "./routers/integration";

export const appRouter = router({
  workspace: workspaceRouter,
  ingestion: ingestionRouter,
  icp: icpRouter,
  tam: tamRouter,
  integration: integrationRouter,
});

export type AppRouter = typeof appRouter;
