"use client";

import { useState, useCallback } from "react";
import { LinkedinLogo } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SourceCard, type SourceStatus } from "./source-card";
import { trpc } from "@/lib/trpc-client";

interface LinkedInSourceProps {
  type: "linkedin_company" | "linkedin_profile";
  title: string;
  description: string;
  placeholder: string;
  urlPattern: string;
}

export function LinkedInSource({ type, title, description, placeholder, urlPattern }: LinkedInSourceProps) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<SourceStatus>("empty");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  const processUrl = trpc.ingestion.processUrl.useMutation({
    onSuccess: (result) => {
      if (result.status === "complete") {
        setStatus("success");
      } else {
        setStatus("error");
        setError(result.error ?? "Failed to scrape LinkedIn");
      }
    },
    onError: (err) => {
      setStatus("error");
      setError(err.message);
    },
  });

  // Fetch the source data after success
  const sourcesQuery = trpc.ingestion.getSources.useQuery(undefined, {
    enabled: status === "success",
  });
  const sources = sourcesQuery.data as Array<{ type: string; structuredData: Record<string, string> | null }> | undefined;
  const source = sources?.find((s) => s.type === type);
  const structuredData = source?.structuredData ?? null;

  const handleAnalyze = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!trimmed.includes("linkedin.com")) {
      setError("Please enter a valid LinkedIn URL");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError(null);
    processUrl.mutate({ type, url: trimmed });
  }, [url, type, processUrl]);

  return (
    <SourceCard
      title={title}
      description={description}
      icon={<LinkedinLogo className="size-5" weight="fill" />}
      status={status}
      errorMessage={error ?? undefined}
      preview={
        structuredData ? (
          <div className="space-y-1">
            {structuredData.name && (
              <p className="text-xs font-medium text-foreground">{String(structuredData.name)}</p>
            )}
            {structuredData.headline && (
              <p className="text-[11px] text-muted-foreground">{String(structuredData.headline)}</p>
            )}
            {structuredData.industry && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-700 font-medium">
                {String(structuredData.industry)}
              </span>
            )}
            {structuredData.employeeCount && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 font-medium ml-1">
                {String(structuredData.employeeCount)} employees
              </span>
            )}
          </div>
        ) : status === "success" ? (
          <p className="text-xs text-muted-foreground">LinkedIn data extracted</p>
        ) : null
      }
    >
      <div className="flex gap-2">
        <Input
          placeholder={placeholder}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
          disabled={status === "loading"}
          className="text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={handleAnalyze}
          disabled={!url.trim() || status === "loading"}
        >
          {status === "loading" ? "..." : "Add"}
        </Button>
      </div>
    </SourceCard>
  );
}
