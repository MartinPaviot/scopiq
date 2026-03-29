"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface BuildProgress {
  type: "progress" | "complete" | "error";
  phase: string;
  message: string;
  data?: {
    totalCount?: number;
    loadedCount?: number;
    scoredCount?: number;
  };
}

/**
 * Hook to subscribe to TAM build SSE stream.
 * Returns current progress + a start function.
 */
export function useBuildStream() {
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  const start = useCallback((buildId: string) => {
    // Close previous
    if (sourceRef.current) {
      sourceRef.current.close();
    }

    setIsStreaming(true);
    setProgress({ type: "progress", phase: "pending", message: "Starting build..." });

    const es = new EventSource(`/api/tam/stream?buildId=${buildId}`);
    sourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as BuildProgress;
        setProgress(data);

        if (data.type === "complete" || data.type === "error") {
          setIsStreaming(false);
          es.close();
          sourceRef.current = null;
        }
      } catch {
        // Invalid JSON — ignore
      }
    };

    es.onerror = () => {
      setIsStreaming(false);
      es.close();
      sourceRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        sourceRef.current.close();
      }
    };
  }, []);

  return { progress, isStreaming, start, stop };
}
