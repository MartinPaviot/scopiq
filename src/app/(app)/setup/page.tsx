"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Rocket, FileText, Database, LinkedinLogo,
  MagnifyingGlass, ChartBar, Lightning, CheckCircle, Spinner,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { WebsiteSource } from "@/components/setup/website-source";
import { CsvSource } from "@/components/setup/csv-source";
import { LinkedInSource } from "@/components/setup/linkedin-source";
import { ConnectionsSource } from "@/components/setup/connections-source";
import { DocumentSource } from "@/components/setup/document-source";
import { CrmSource } from "@/components/setup/crm-source";
import { trpc } from "@/lib/trpc-client";
import { toast } from "sonner";
import { useBuildStream, type BuildProgress } from "@/lib/use-build-stream";
import { cn } from "@/lib/utils";

// ─── ICP + TAM Progress Panel ──────────────────

const ICP_PHASES = [
  { id: "analyzing", label: "Analyzing your data sources...", icon: MagnifyingGlass },
  { id: "inferring", label: "Generating ICP with AI...", icon: Lightning },
  { id: "done", label: "ICP ready!", icon: CheckCircle },
];

const TAM_PHASES = [
  { id: "counting", label: "Counting your market...", icon: ChartBar },
  { id: "loading-top", label: "Loading top accounts...", icon: MagnifyingGlass },
  { id: "scoring", label: "Scoring accounts...", icon: ChartBar },
  { id: "complete", label: "TAM build complete!", icon: CheckCircle },
];

function ProgressPanel({ icpPhase, tamProgress }: { icpPhase: string; tamProgress: BuildProgress | null }) {
  const allPhases = tamProgress
    ? [...ICP_PHASES, ...TAM_PHASES]
    : ICP_PHASES;

  const currentId = tamProgress?.phase ?? icpPhase;

  return (
    <div className="max-w-md mx-auto mt-8 p-6 border rounded-xl bg-card animate-fade-in-up">
      <h3 className="text-sm font-semibold text-foreground mb-4">Building your market intelligence...</h3>
      <div className="space-y-3">
        {allPhases.map((phase) => {
          const Icon = phase.icon;
          const isCurrent = phase.id === currentId;
          const isPast = allPhases.indexOf(phase) < allPhases.findIndex((p) => p.id === currentId);
          const isDone = phase.id === "done" && icpPhase === "done";
          const isComplete = phase.id === "complete" && tamProgress?.type === "complete";

          return (
            <div key={phase.id} className={cn(
              "flex items-center gap-3 text-sm transition-colors",
              isCurrent ? "text-foreground font-medium" : isPast || isDone || isComplete ? "text-emerald-600" : "text-muted-foreground/50",
            )}>
              {isCurrent && !isDone && !isComplete ? (
                <Spinner className="size-4 animate-spin text-primary shrink-0" />
              ) : isPast || isDone || isComplete ? (
                <CheckCircle className="size-4 text-emerald-500 shrink-0" weight="fill" />
              ) : (
                <Icon className="size-4 shrink-0" />
              )}
              <span>{phase.label}</span>
            </div>
          );
        })}
      </div>
      {tamProgress?.data?.loadedCount != null && (
        <div className="mt-3 pt-3 border-t text-xs text-muted-foreground tabular-nums">
          {tamProgress.data.loadedCount} accounts loaded
          {tamProgress.data.totalCount ? ` / ${tamProgress.data.totalCount} total` : ""}
          {tamProgress.data.scoredCount ? ` · ${tamProgress.data.scoredCount} scored` : ""}
        </div>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────

export default function SetupPage() {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [icpPhase, setIcpPhase] = useState("idle");
  const { progress: tamProgress, isStreaming, start: startStream } = useBuildStream();

  const sourcesQuery = trpc.ingestion.getSources.useQuery();
  const workspaceQuery = trpc.workspace.getSettings.useQuery();

  const inferMutation = trpc.icp.infer.useMutation({
    onSuccess: () => {
      setIcpPhase("done");
      toast.success("ICP generated!");

      // Auto-start TAM build
      const companyUrl = (workspaceQuery.data as Record<string, string> | undefined)?.companyUrl ?? "";
      tamBuildMutation.mutate({ siteUrl: companyUrl || "https://example.com" });
    },
    onError: (err) => {
      toast.error(err.message ?? "Failed to generate ICP");
      setIsGenerating(false);
      setIcpPhase("idle");
    },
  });

  const tamBuildMutation = trpc.tam.startBuild.useMutation({
    onSuccess: (data) => {
      // Start SSE stream for TAM build progress
      startStream(data.tamBuildId);
    },
    onError: (err) => {
      toast.error(err.message ?? "Failed to start TAM build");
    },
  });

  // Redirect to market when TAM build completes
  if (tamProgress?.type === "complete") {
    setTimeout(() => router.push("/market"), 1500);
  }

  const sources = (sourcesQuery.data ?? []) as Array<{ type: string; status: string }>;
  const completedCount = sources.filter((s) => s.status === "complete").length;
  const hasWebsite = sources.some((s) => s.type === "website" && s.status === "complete");

  const handleGenerateIcp = () => {
    setIsGenerating(true);
    setIcpPhase("analyzing");
    // Simulate a brief analyzing phase then start inference
    setTimeout(() => {
      setIcpPhase("inferring");
      inferMutation.mutate();
    }, 800);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <h1 className="text-2xl font-heading font-bold text-foreground">
            Tell us about your business
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-lg">
            The more data you provide, the more precise your ICP and TAM will be.
            Start with your website — everything else is optional but improves accuracy.
          </p>

          {/* Progress */}
          <div className="flex items-center gap-3 mt-5">
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`h-1.5 w-8 rounded-full transition-colors ${
                    i < completedCount ? "bg-primary" : "bg-muted"
                  }`}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {completedCount} source{completedCount !== 1 ? "s" : ""} provided
            </span>
          </div>
        </div>
      </div>

      {/* Sources Grid */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="grid gap-4 md:grid-cols-2">
          {/* P0 Sources */}
          <div className="md:col-span-2">
            <WebsiteSource />
          </div>

          <CsvSource />

          <LinkedInSource
            type="linkedin_company"
            title="LinkedIn Company Page"
            description="Industry, size, and specialties from your company profile"
            placeholder="https://linkedin.com/company/your-company"
            urlPattern="linkedin.com/company/"
          />

          <LinkedInSource
            type="linkedin_profile"
            title="Your LinkedIn Profile"
            description="Your background helps us understand product-market intuition"
            placeholder="https://linkedin.com/in/your-name"
            urlPattern="linkedin.com/in/"
          />

          {/* Additional Sources */}
          <ConnectionsSource />

          <DocumentSource />

          <CrmSource />
        </div>

        {/* Generate ICP CTA or Progress Panel */}
        {isGenerating ? (
          <ProgressPanel icpPhase={icpPhase} tamProgress={tamProgress} />
        ) : (
          <>
            <div className="mt-8 flex justify-center">
              <Button
                size="lg"
                className="gap-2 px-8"
                disabled={!hasWebsite || isGenerating}
                onClick={handleGenerateIcp}
              >
                <Rocket className="size-4" weight="fill" />
                Generate ICP & Build TAM
              </Button>
            </div>
            {!hasWebsite && (
              <p className="text-center text-xs text-muted-foreground mt-2">
                Add your website URL to get started
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
