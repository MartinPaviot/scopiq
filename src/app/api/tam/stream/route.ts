import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

/**
 * SSE endpoint for TAM build + ICP inference progress.
 * Polls the TamBuild record every 1s and streams phase/count updates.
 * Client connects with EventSource("/api/tam/stream?buildId=xxx").
 */
export async function GET(req: Request) {
  // Auth check
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const buildId = url.searchParams.get("buildId");
  if (!buildId) {
    return new Response("Missing buildId", { status: 400 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      let lastPhase = "";
      let lastLoaded = 0;

      // Poll every second
      const interval = setInterval(async () => {
        if (closed) {
          clearInterval(interval);
          return;
        }

        try {
          const build = await prisma.tamBuild.findUnique({
            where: { id: buildId },
            select: {
              status: true,
              phase: true,
              totalCount: true,
              loadedCount: true,
              scoredCount: true,
              errorMessage: true,
              completedAt: true,
            },
          });

          if (!build) {
            send({ type: "error", message: "Build not found" });
            clearInterval(interval);
            controller.close();
            closed = true;
            return;
          }

          // Only send if something changed
          if (build.phase !== lastPhase || build.loadedCount !== lastLoaded) {
            lastPhase = build.phase;
            lastLoaded = build.loadedCount;

            const PHASE_LABELS: Record<string, string> = {
              pending: "Starting build...",
              analyzing: "Analyzing your offer...",
              counting: "Counting your market...",
              "loading-top": "Loading top accounts...",
              expanding: "Loading more accounts...",
              scoring: "Scoring accounts...",
              "rate-limited": "Rate limited — pausing...",
              complete: "TAM build complete!",
              failed: build.errorMessage ?? "Build failed",
            };

            send({
              type: build.status === "complete" ? "complete" : build.status === "failed" ? "error" : "progress",
              phase: build.phase,
              message: PHASE_LABELS[build.phase] ?? build.phase,
              data: {
                totalCount: build.totalCount,
                loadedCount: build.loadedCount,
                scoredCount: build.scoredCount,
              },
            });
          }

          // Stop polling on terminal states
          if (build.status === "complete" || build.status === "failed") {
            clearInterval(interval);
            setTimeout(() => {
              if (!closed) {
                controller.close();
                closed = true;
              }
            }, 1000);
          }
        } catch {
          // DB error — keep trying
        }
      }, 1000);

      // Cleanup on abort
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
