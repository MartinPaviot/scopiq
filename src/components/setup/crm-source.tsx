"use client";

import { useState, useCallback, useRef } from "react";
import { Database, UploadSimple, Key, Spinner, CheckCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SourceCard, type SourceStatus } from "./source-card";
import { trpc } from "@/lib/trpc-client";
import { toast } from "sonner";

interface PatternSummary {
  topIndustries: Array<{ value: string; percentage: number }>;
  topSizes: Array<{ value: string; percentage: number }>;
  totalCustomers: number;
}

export function CrmSource() {
  const [status, setStatus] = useState<SourceStatus>("empty");
  const [error, setError] = useState<string | null>(null);
  const [patterns, setPatterns] = useState<PatternSummary | null>(null);
  const [mode, setMode] = useState<"choose" | "apikey" | "csv">("choose");
  const [apiKey, setApiKey] = useState("");
  const [pulling, setPulling] = useState(false);

  const connectMutation = trpc.integration.connect.useMutation();

  const processUpload = trpc.ingestion.processUpload.useMutation({
    onSuccess: (data) => {
      if (data.status === "complete" && "patterns" in data && data.patterns) {
        setPatterns(data.patterns as PatternSummary);
        setStatus("success");
      } else if (data.status === "error") {
        setStatus("error");
        setError(data.error ?? "Failed to process");
      } else {
        setStatus("success");
      }
    },
    onError: (err) => {
      setStatus("error");
      setError(err.message);
    },
  });

  // Pull companies from HubSpot using API key
  const pullFromHubspot = useCallback(async () => {
    if (!apiKey.trim()) return;
    setPulling(true);
    setError(null);
    setStatus("loading");

    try {
      // Save the API key as integration
      await connectMutation.mutateAsync({ type: "hubspot", apiKey: apiKey.trim() });

      // Pull companies directly using the key
      const res = await fetch(
        "https://api.hubapi.com/crm/v3/objects/companies?limit=100&properties=name,domain,industry,numberofemployees,country",
        { headers: { Authorization: `Bearer ${apiKey.trim()}` } },
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HubSpot API error ${res.status}: ${text.slice(0, 100)}`);
      }

      const data = await res.json();
      const companies = data.results ?? [];

      if (companies.length === 0) {
        setStatus("success");
        setPatterns({ topIndustries: [], topSizes: [], totalCustomers: 0 });
        toast.success("HubSpot connected — no companies found");
        return;
      }

      // Convert to CSV format and process via ingestion router
      const csvLines = ["company,domain,industry,employees,country"];
      for (const c of companies) {
        const p = c.properties ?? {};
        csvLines.push(
          [p.name ?? "", p.domain ?? "", p.industry ?? "", p.numberofemployees ?? "", p.country ?? ""]
            .map((v: string) => `"${v.replace(/"/g, '""')}"`)
            .join(","),
        );
      }

      processUpload.mutate({
        type: "csv_customers",
        fileName: "hubspot-import.csv",
        content: csvLines.join("\n"),
      });

      toast.success(`Pulled ${companies.length} companies from HubSpot`);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to connect HubSpot");
    } finally {
      setPulling(false);
    }
  }, [apiKey, connectMutation, processUpload]);

  // Handle CSV CRM export upload
  const handleCsvUpload = useCallback(async (file: File) => {
    setStatus("loading");
    setError(null);
    const content = await file.text();
    processUpload.mutate({ type: "csv_customers", fileName: `crm-${file.name}`, content });
  }, [processUpload]);

  return (
    <SourceCard
      title="CRM Import"
      description="Connect HubSpot via API key or upload a CRM export"
      icon={<Database className="size-5" />}
      status={status}
      errorMessage={error ?? undefined}
      preview={
        patterns ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CheckCircle className="size-3.5 text-emerald-500" weight="fill" />
              <span className="text-xs text-foreground font-medium">
                {patterns.totalCustomers} companies imported
              </span>
            </div>
            {patterns.topIndustries?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {patterns.topIndustries.map((i) => (
                  <span key={i.value} className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-700 font-medium">
                    {i.value} ({i.percentage}%)
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : null
      }
    >
      {mode === "choose" && (
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => setMode("apikey")}
          >
            <Key className="size-3.5" />
            HubSpot API Key
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5"
            onClick={() => setMode("csv")}
          >
            <UploadSimple className="size-3.5" />
            Upload CSV
          </Button>
        </div>
      )}

      {mode === "apikey" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="HubSpot Private App access token"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && pullFromHubspot()}
              className="text-xs"
            />
            <Button
              size="sm"
              onClick={pullFromHubspot}
              disabled={!apiKey.trim() || pulling}
            >
              {pulling ? <Spinner className="size-3.5 animate-spin" /> : "Pull"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Settings → Integrations → Private Apps → Create token with CRM read scope
          </p>
          <button
            onClick={() => setMode("choose")}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Back
          </button>
        </div>
      )}

      {mode === "csv" && (
        <div className="space-y-2">
          <div
            className="border-2 border-dashed rounded-lg p-3 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".csv,.tsv";
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) handleCsvUpload(file);
              };
              input.click();
            }}
          >
            <UploadSimple className="size-5 mx-auto text-muted-foreground mb-1" />
            <p className="text-xs text-muted-foreground">
              CRM export CSV (HubSpot, Pipedrive, Salesforce...)
            </p>
          </div>
          <button
            onClick={() => setMode("choose")}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Back
          </button>
        </div>
      )}
    </SourceCard>
  );
}
