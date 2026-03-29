"use client";

import { useState, useCallback } from "react";
import { Globe } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SourceCard, type SourceStatus } from "./source-card";
import { trpc } from "@/lib/trpc-client";

interface CompanyDnaPreview {
  oneLiner?: string;
  targetBuyers?: Array<{ role: string; sellingAngle?: string }>;
  pricingModel?: string;
  differentiators?: string[];
}

export function WebsiteSource() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<SourceStatus>("empty");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CompanyDnaPreview | null>(null);

  const processUrl = trpc.ingestion.processUrl.useMutation({
    onSuccess: (data) => {
      if (data.status === "complete") {
        setStatus("success");
      } else {
        setStatus("error");
        setError(data.error ?? "Failed to analyze website");
      }
    },
    onError: (err) => {
      setStatus("error");
      setError(err.message);
    },
  });

  // Fetch CompanyDna after processing
  const workspaceQuery = trpc.workspace.getOnboardingData.useQuery(undefined, {
    enabled: status === "success",
  });

  const companyDna = (workspaceQuery.data as Record<string, unknown> | undefined)?.companyDna as CompanyDnaPreview | null;

  const handleAnalyze = useCallback(() => {
    if (!url.trim()) return;
    setStatus("loading");
    setError(null);
    processUrl.mutate({ type: "website", url: url.trim() });
  }, [url, processUrl]);

  return (
    <SourceCard
      title="Website URL"
      description="We'll analyze your site to understand your product, market, and positioning"
      icon={<Globe className="size-5" />}
      status={status}
      priority
      errorMessage={error ?? undefined}
      preview={
        companyDna?.oneLiner ? (
          <div className="space-y-2">
            <p className="text-xs text-foreground/80 italic">&ldquo;{companyDna.oneLiner}&rdquo;</p>
            {companyDna.targetBuyers && companyDna.targetBuyers.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {companyDna.targetBuyers.slice(0, 3).map((b, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                    {b.role}
                  </span>
                ))}
              </div>
            )}
            {companyDna.pricingModel && (
              <span className="text-[10px] text-muted-foreground">Pricing: {companyDna.pricingModel}</span>
            )}
          </div>
        ) : status === "success" ? (
          <p className="text-xs text-muted-foreground">Website analyzed successfully</p>
        ) : null
      }
    >
      <div className="flex gap-2">
        <Input
          placeholder="https://your-company.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
          disabled={status === "loading"}
          className="text-sm"
        />
        <Button
          size="sm"
          onClick={handleAnalyze}
          disabled={!url.trim() || status === "loading"}
        >
          {status === "loading" ? "Analyzing..." : "Analyze"}
        </Button>
      </div>
    </SourceCard>
  );
}
