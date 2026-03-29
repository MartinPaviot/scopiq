import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";

// Functions will be registered here as they're ported in Phase B
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [],
});
