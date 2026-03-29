import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  buildTam,
  expandTam,
  enrichSignals,
  weeklySignalRefresh,
  resumeRateLimitedBuilds,
  linkedInConnectionSync,
} from "@/inngest/tam-build";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    buildTam,
    expandTam,
    enrichSignals,
    weeklySignalRefresh,
    resumeRateLimitedBuilds,
    linkedInConnectionSync,
  ],
});
