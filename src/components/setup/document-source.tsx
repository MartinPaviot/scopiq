"use client";

import { useState, useCallback, useRef } from "react";
import { FileText, UploadSimple } from "@phosphor-icons/react";
import { SourceCard, type SourceStatus } from "./source-card";
import { trpc } from "@/lib/trpc-client";

export function DocumentSource() {
  const [status, setStatus] = useState<SourceStatus>("empty");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const processUpload = trpc.ingestion.processUpload.useMutation({
    onSuccess: (data) => {
      if (data.status === "complete") {
        setStatus("success");
      } else {
        setStatus("error");
        setError(data.error ?? "Failed to process document");
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

    try {
      let content: string;

      if (file.name.endsWith(".txt") || file.name.endsWith(".md")) {
        content = await file.text();
      } else if (file.name.endsWith(".pdf")) {
        // For PDF, we send the raw text. In a real implementation,
        // we'd use a PDF parser library. For now, try to read as text.
        content = await file.text();
        if (content.startsWith("%PDF")) {
          // Binary PDF — can't extract text client-side without a library
          setStatus("error");
          setError("PDF parsing requires server-side processing. Please convert to TXT first, or paste the content directly.");
          return;
        }
      } else {
        content = await file.text();
      }

      setPreview(content.slice(0, 200));
      processUpload.mutate({ type: "document", fileName: file.name, content: content.slice(0, 500_000) });
    } catch {
      setStatus("error");
      setError("Could not read file");
    }
  }, [processUpload]);

  return (
    <SourceCard
      title="Strategic Documents"
      description="Upload pitch decks, strategy docs, or market research"
      icon={<FileText className="size-5" />}
      status={status}
      errorMessage={error ?? undefined}
      preview={
        preview ? (
          <div>
            <p className="text-xs font-medium text-foreground">{fileName}</p>
            <p className="text-[10px] text-muted-foreground mt-1 line-clamp-3">{preview}...</p>
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
          {fileName ?? "Drop TXT, PDF, or DOCX here"}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.pdf,.docx"
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
