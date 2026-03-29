"use client";

import { ClockCounterClockwise, ArrowsClockwise, Plus, Minus, TrendUp } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc-client";
import { cn } from "@/lib/utils";

export default function ChangelogPage() {
  // List all TAM builds as changelog entries
  const buildQuery = trpc.tam.getLatestBuild.useQuery();
  const build = buildQuery.data;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-heading font-bold flex items-center gap-2">
            <ClockCounterClockwise className="size-5" />
            TAM Changelog
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            History of TAM builds and signal refreshes
          </p>
        </div>
      </div>

      {!build ? (
        <div className="text-center py-16">
          <ClockCounterClockwise className="size-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No TAM builds yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Current build info */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "size-2 rounded-full",
                  build.status === "complete" ? "bg-emerald-500" : build.status === "failed" ? "bg-red-500" : "bg-amber-500 animate-pulse",
                )} />
                <span className="text-sm font-semibold text-foreground capitalize">{build.status}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {build.createdAt ? new Date(build.createdAt as string).toLocaleString() : ""}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-4 mt-3">
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{build.totalCount?.toLocaleString() ?? "—"}</p>
                <p className="text-[10px] text-muted-foreground">Total market</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{build.loadedCount?.toLocaleString() ?? "—"}</p>
                <p className="text-[10px] text-muted-foreground">Loaded</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{build.scoredCount?.toLocaleString() ?? "—"}</p>
                <p className="text-[10px] text-muted-foreground">Scored</p>
              </div>
            </div>

            {build.siteUrl && (
              <p className="text-[10px] text-muted-foreground mt-3">
                Source: {build.siteUrl as string}
              </p>
            )}
          </div>

          {/* Auto-refresh info */}
          <div className="border rounded-lg p-4 bg-muted/30">
            <h3 className="text-sm font-semibold mb-2">Auto-Refresh Schedule</h3>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <ArrowsClockwise className="size-3.5 text-primary" />
                <span>Signal refresh: <strong className="text-foreground">Every Monday 06:00 UTC</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <ArrowsClockwise className="size-3.5 text-primary" />
                <span>Rate-limit recovery: <strong className="text-foreground">Daily 00:30 UTC</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <ArrowsClockwise className="size-3.5 text-primary" />
                <span>LinkedIn sync: <strong className="text-foreground">Every Sunday 05:00 UTC</strong></span>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-3">
              Schedules are managed by Inngest cron functions. Custom frequency configuration coming soon.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
