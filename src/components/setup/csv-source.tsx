"use client";

import { useState, useCallback, useRef } from "react";
import { Table, UploadSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { SourceCard, type SourceStatus } from "./source-card";
import { trpc } from "@/lib/trpc-client";

interface PatternSummary {
  topIndustries: Array<{ value: string; percentage: number }>;
  topSizes: Array<{ value: string; percentage: number }>;
  topGeos: Array<{ value: string; percentage: number }>;
  avgDealValue: number | null;
  totalCustomers: number;
}

export function CsvSource() {
  const [status, setStatus] = useState<SourceStatus>("empty");
  const [error, setError] = useState<string | null>(null);
  const [patterns, setPatterns] = useState<PatternSummary | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const processUpload = trpc.ingestion.processUpload.useMutation({
    onSuccess: (data) => {
      if (data.status === "complete") {
        setStatus("success");
        if ("patterns" in data && data.patterns) {
          setPatterns(data.patterns as PatternSummary);
        }
      } else {
        setStatus("error");
        setError(data.error ?? "Failed to process CSV");
      }
    },
    onError: (err) => {
      setStatus("error");
      setError(err.message);
    },
  });

  const handleFile = useCallback(
    async (file: File) => {
      setFileName(file.name);
      setStatus("loading");
      setError(null);

      const content = await file.text();
      processUpload.mutate({
        type: "csv_customers",
        fileName: file.name,
        content,
      });
    },
    [processUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".csv") || file.name.endsWith(".tsv"))) {
        handleFile(file);
      }
    },
    [handleFile],
  );

  return (
    <SourceCard
      title="Customer CSV"
      description="Upload your existing customers — this is the best signal to ground your ICP in reality"
      icon={<Table className="size-5" />}
      status={status}
      errorMessage={error ?? undefined}
      preview={
        patterns ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-foreground">{patterns.totalCustomers}</span>
              <span className="text-muted-foreground">customers imported</span>
              {patterns.avgDealValue && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">Avg deal ${patterns.avgDealValue.toLocaleString()}</span>
                </>
              )}
            </div>
            {patterns.topIndustries.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {patterns.topIndustries.map((i) => (
                  <span key={i.value} className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-700 font-medium">
                    {i.value} ({i.percentage}%)
                  </span>
                ))}
              </div>
            )}
            {patterns.topSizes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {patterns.topSizes.map((s) => (
                  <span key={s.value} className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 font-medium">
                    {s.value} emp ({s.percentage}%)
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : null
      }
    >
      <div
        className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        <UploadSimple className="size-6 mx-auto text-muted-foreground mb-1" />
        <p className="text-xs text-muted-foreground">
          {fileName ? fileName : "Drop CSV here or click to browse"}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
    </SourceCard>
  );
}
