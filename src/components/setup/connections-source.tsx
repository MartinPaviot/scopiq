"use client";

import { useState, useCallback, useRef } from "react";
import { LinkedinLogo, UploadSimple } from "@phosphor-icons/react";
import { SourceCard, type SourceStatus } from "./source-card";
import { trpc } from "@/lib/trpc-client";

export function ConnectionsSource() {
  const [status, setStatus] = useState<SourceStatus>("empty");
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [topCompanies, setTopCompanies] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const processUpload = trpc.ingestion.processUpload.useMutation({
    onSuccess: (data) => {
      if (data.status === "complete" && "patterns" in data && data.patterns) {
        const p = data.patterns as { totalCustomers: number; topCompanies?: string[] };
        setCount(p.totalCustomers);
        setTopCompanies(p.topCompanies ?? []);
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

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setStatus("loading");
    setError(null);
    const content = await file.text();
    processUpload.mutate({ type: "csv_customers", fileName: file.name, content });
  }, [processUpload]);

  return (
    <SourceCard
      title="LinkedIn Connections"
      description="Upload your LinkedIn connections CSV for network proximity signals"
      icon={<LinkedinLogo className="size-5" weight="fill" />}
      status={status}
      errorMessage={error ?? undefined}
      preview={
        count > 0 ? (
          <div className="space-y-1">
            <p className="text-xs text-foreground">
              <span className="font-semibold">{count}</span> connections imported
            </p>
            {topCompanies.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {topCompanies.slice(0, 5).map((c) => (
                  <span key={c} className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-700 font-medium">{c}</span>
                ))}
              </div>
            )}
          </div>
        ) : null
      }
    >
      <div
        className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => fileRef.current?.click()}
      >
        <UploadSimple className="size-5 mx-auto text-muted-foreground mb-1" />
        <p className="text-xs text-muted-foreground">
          {fileName ?? "Drop LinkedIn export CSV here"}
        </p>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
          Settings → Data Privacy → Get a copy of your data → Connections
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
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
