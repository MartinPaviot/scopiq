"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import {
  Rocket, Globe, LinkedinLogo, FileText, Database,
  CaretDown, CheckCircle, Spinner, MagnifyingGlass,
  ChartBar, Lightning, Sparkle, Users,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc-client";
import { toast } from "sonner";
import { useBuildStream, type BuildProgress } from "@/lib/use-build-stream";

// ─── Tier Section Wrapper ──────────────────────

function TierSection({
  title,
  subtitle,
  defaultOpen = true,
  children,
  delay = 0,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  delay?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="hero-stagger" style={{ animationDelay: `${delay}ms` }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 w-full text-left group mb-4"
      >
        <div className="flex-1">
          <h2 className="text-lg font-heading font-semibold text-foreground group-hover:text-primary transition-colors">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        <CaretDown
          className={cn(
            "size-4 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in-up">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Input Card (premium feel) ─────────────────

function InputCard({
  icon,
  label,
  hint,
  complete,
  onRemove,
  children,
  delay = 0,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  complete?: boolean;
  onRemove?: () => void;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <div
      className={cn(
        "hero-stagger relative rounded-2xl border bg-card/80 backdrop-blur-sm p-4 transition-all duration-300 input-glow flex flex-col h-full",
        complete
          ? "border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/10"
          : "border-border/50 hover:border-border hover:shadow-md",
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className={cn(
            "flex items-center justify-center size-8 rounded-lg shrink-0 transition-colors",
            complete
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-muted/80 text-muted-foreground",
          )}
        >
          {complete ? (
            <CheckCircle className="size-4 animate-check-pop" weight="fill" />
          ) : (
            icon
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-foreground leading-tight">{label}</h3>
          {hint && !complete && (
            <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{hint}</p>
          )}
        </div>
        {complete && onRemove && (
          <button
            onClick={onRemove}
            className="ml-auto text-[9px] font-medium px-1.5 py-0.5 rounded-full text-red-500 hover:bg-red-500/10 transition-colors shrink-0"
          >
            Remove
          </button>
        )}
        {complete && !onRemove && (
          <span className="ml-auto text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 shrink-0">
            Done
          </span>
        )}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// ─── Progress Panel (ICP + TAM build) ──────────

// Only phases actually emitted by backend (ICP flow + TAM SSE stream)
const BUILD_PHASES = [
  { id: "analyzing", label: "Analyzing your data sources" },
  { id: "inferring", label: "Generating your ICP" },
  { id: "done-icp", label: "ICP ready" },
  { id: "counting", label: "Counting your market" },
  { id: "loading-top", label: "Loading top accounts" },
  { id: "expanding", label: "Loading more accounts" },
  { id: "scoring", label: "Scoring accounts" },
  { id: "complete", label: "TAM build complete" },
];

const PHASE_LOGS: Record<string, string[]> = {
  analyzing: [
    "Checking ingestion sources...",
    "Found website content in cache",
    "Loading customer import data...",
  ],
  inferring: [
    "Building inference context...",
    "Running AI analysis (structured JSON)...",
    "Parsing roles, industries, geographies...",
    "Mapping to search filters...",
  ],
  "done-icp": [
    "ICP saved — version 1",
    "Starting TAM build...",
  ],
  counting: [
    "Converting ICP to search filters...",
    "Querying organization database...",
  ],
  "loading-top": [
    "Loading first batch of accounts...",
    "Enriching company data...",
  ],
  expanding: [
    "Loading additional pages...",
    "Deduplicating results...",
  ],
  scoring: [
    "Industry fit (0-25 pts)...",
    "Size fit (0-25 pts)...",
    "Keyword overlap (0-20 pts)...",
    "Data freshness (0-10 pts)...",
    "Assigning tiers: A / B / C / D",
  ],
  complete: [
    "Quality validation passed",
    "Redirecting to market view...",
  ],
};

function ProgressPanel({ icpPhase, tamProgress }: { icpPhase: string; tamProgress: BuildProgress | null }) {
  // Ignore "pending" / "rate-limited" from TAM stream — keep showing ICP phase
  const tamPhase = tamProgress?.phase;
  const currentId = tamPhase && tamPhase !== "pending" && tamPhase !== "rate-limited" ? tamPhase : icpPhase;
  const currentIdx = BUILD_PHASES.findIndex((p) => p.id === currentId);
  const [logs, setLogs] = useState<string[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Timer
  useEffect(() => {
    const interval = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Simulate sub-logs for current phase
  useEffect(() => {
    const phaseLogs = PHASE_LOGS[currentId] ?? [];
    if (phaseLogs.length === 0) return;

    let i = 0;
    const interval = setInterval(() => {
      if (i < phaseLogs.length) {
        setLogs((prev) => [...prev.slice(-15), phaseLogs[i]]);
        i++;
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [currentId]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Add real TAM progress as logs
  useEffect(() => {
    if (tamProgress?.data?.loadedCount) {
      setLogs((prev) => [
        ...prev.slice(-15),
        `${tamProgress.data!.loadedCount} accounts loaded${tamProgress.data!.totalCount ? ` / ${tamProgress.data!.totalCount} total market` : ""}`,
      ]);
    }
    if (tamProgress?.data?.scoredCount) {
      setLogs((prev) => [...prev.slice(-15), `${tamProgress.data!.scoredCount} accounts scored`]);
    }
  }, [tamProgress?.data?.loadedCount, tamProgress?.data?.scoredCount]);

  return (
    <div className="max-w-lg mx-auto mt-6 hero-stagger" style={{ animationDelay: "0ms" }}>
      <div className="rounded-2xl border bg-card/80 backdrop-blur-sm p-6 glow-teal">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center animate-pulse-ring">
              <Sparkle className="size-5 text-primary" weight="fill" />
            </div>
            <div>
              <h3 className="text-sm font-heading font-semibold">Building your market intelligence</h3>
              <p className="text-[11px] text-muted-foreground">{elapsedSec}s elapsed</p>
            </div>
          </div>
        </div>

        {/* Phase steps */}
        <div className="space-y-2 mb-4">
          {BUILD_PHASES.map((phase, i) => {
            const isCurrent = phase.id === currentId;
            const isPast = currentIdx >= 0 && i < currentIdx;
            if (i > currentIdx + 2 && !isPast) return null;

            return (
              <div key={phase.id} className={cn(
                "flex items-center gap-2.5 text-[13px] transition-all duration-300",
                isCurrent ? "text-foreground font-medium" : isPast ? "text-emerald-600" : "text-muted-foreground/30",
              )}>
                {isCurrent ? (
                  <Spinner className="size-3.5 animate-spin text-primary shrink-0" />
                ) : isPast ? (
                  <CheckCircle className="size-3.5 text-emerald-500 shrink-0" weight="fill" />
                ) : (
                  <div className="size-3.5 rounded-full border border-current shrink-0" />
                )}
                <span>{phase.label}</span>
                {isCurrent && tamProgress?.data?.loadedCount != null && phase.id.startsWith("loading") && (
                  <span className="ml-auto text-[10px] tabular-nums text-primary font-medium">
                    {tamProgress.data.loadedCount} loaded
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Live log feed */}
        <div className="border-t pt-3">
          <div className="flex items-center gap-1.5 mb-2">
            <div className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Live log</span>
          </div>
          <div className="h-28 overflow-y-auto scrollbar-thin rounded-lg bg-muted/30 p-2 font-mono text-[10px] text-muted-foreground space-y-0.5">
            {logs.map((log, i) => (
              <div key={i} className={cn(
                "animate-fade-in-up",
                i === logs.length - 1 ? "text-foreground" : "",
              )}>
                <span className="text-muted-foreground/40 mr-1.5">{String(i + 1).padStart(2, "0")}</span>
                {log}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Inline CRM Connect ────────────────────────

function CrmConnect({ onConnect }: { onConnect: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const connectMutation = trpc.integration.connect.useMutation();
  const pullMutation = trpc.integration.pullHubspot.useMutation();

  const handleConnect = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    try {
      await connectMutation.mutateAsync({ type: "hubspot", apiKey: apiKey.trim() });
      const result = await pullMutation.mutateAsync();
      toast.success(`Pulled ${result.companies} companies from HubSpot`);
      onConnect();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Input
        type="password"
        placeholder="HubSpot Private App token"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleConnect()}
        className="h-10"
      />
      <Button variant="outline" onClick={handleConnect} disabled={!apiKey.trim() || loading} className="shrink-0">
        {loading ? <Spinner className="size-4 animate-spin" /> : "Pull"}
      </Button>
    </div>
  );
}

// ─── Page ──────────────────────────────────────

export default function SetupPage() {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [icpPhase, setIcpPhase] = useState("idle");
  const { progress: tamProgress, start: startStream } = useBuildStream();

  // Source states
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [websiteStatus, setWebsiteStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [linkedinStatus, setLinkedinStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [idealDescription, setIdealDescription] = useState("");
  const [dreamCompanies, setDreamCompanies] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [csvUploaded, setCsvUploaded] = useState(false);
  const [crmConnected, setCrmConnected] = useState(false);
  const [docFileName, setDocFileName] = useState("");
  const [csvFileName, setCsvFileName] = useState("");

  const sourcesQuery = trpc.ingestion.getSources.useQuery();
  const workspaceQuery = trpc.workspace.getSettings.useQuery();

  const processUrl = trpc.ingestion.processUrl.useMutation();
  const processUpload = trpc.ingestion.processUpload.useMutation();

  const inferMutation = trpc.icp.infer.useMutation({
    onSuccess: () => {
      setIcpPhase("done-icp");
      const companyUrl = (workspaceQuery.data as Record<string, string> | undefined)?.companyUrl ?? websiteUrl;
      tamBuildMutation.mutate({ siteUrl: companyUrl || "https://example.com" });
    },
    onError: (err) => {
      toast.error(err.message ?? "Failed to generate ICP");
      setIsGenerating(false);
      setIcpPhase("idle");
    },
  });

  const tamBuildMutation = trpc.tam.startBuild.useMutation({
    onSuccess: (data) => startStream(data.tamBuildId),
    onError: (err) => toast.error(err.message),
  });

  // Redirect to ICP page once ICP is ready (user reviews ICP, TAM builds in background)
  const redirectedRef = useRef(false);
  const shouldRedirect = !redirectedRef.current && icpPhase === "done-icp";

  useEffect(() => {
    if (shouldRedirect) {
      redirectedRef.current = true;
      // Small delay so user sees "ICP ready" phase
      setTimeout(() => router.push("/icp"), 1500);
    }
  }, [shouldRedirect, router]);

  // Check completed sources
  type Source = { id: string; type: string; status: string; inputUrl?: string | null; fileName?: string | null; rawContent?: string | null };
  const sources = (sourcesQuery.data ?? []) as Source[];
  const deleteMutation = trpc.ingestion.deleteSource.useMutation({
    onSuccess: () => { sourcesQuery.refetch(); toast.success("Source removed"); },
  });
  const disconnectMutation = trpc.integration.disconnect.useMutation({
    onSuccess: () => { setCrmConnected(false); toast.success("CRM disconnected"); },
  });

  // Check if HubSpot is already connected
  const integrationsQuery = trpc.integration.list.useQuery();
  const hubspotConnected = (integrationsQuery.data ?? []).some((i: { type: string; status: string }) => i.type === "hubspot" && i.status === "ACTIVE");

  const websiteSource = sources.find((s) => s.type === "website" && s.status === "complete");
  const linkedinSource = sources.find((s) => s.type === "linkedin_profile" && s.status === "complete");
  const docSource = sources.find((s) => s.type === "document" && s.status === "complete");
  const csvSource = sources.find((s) => s.type === "csv_customers" && s.status === "complete");
  const crmSource = sources.find((s) => s.type === "crm" && s.status === "complete");

  const idealSource = sources.find((s) => s.type === "ideal_customer" && s.status === "complete");
  const dreamSource = sources.find((s) => s.type === "dream_companies" && s.status === "complete");
  const competitorsSource = sources.find((s) => s.type === "competitors" && s.status === "complete");

  // Hydrate inputs from existing sources
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    // Wait until the sources query has finished loading (not just initial undefined)
    if (sourcesQuery.isLoading || !sourcesQuery.isFetched) return;

    hydratedRef.current = true;
    const srcs = (sourcesQuery.data ?? []) as Source[];

    const find = (type: string) => srcs.find((s) => s.type === type && s.status === "complete");
    const ws = find("website");
    const li = find("linkedin_profile");
    const doc = find("document");
    const csv = find("csv_customers");
    const crm = find("crm");
    const ideal = find("ideal_customer");
    const dream = find("dream_companies");
    const comp = find("competitors");

    if (ws?.inputUrl) setWebsiteUrl(ws.inputUrl);
    if (ws) setWebsiteStatus("done");
    if (li?.inputUrl) setLinkedinUrl(li.inputUrl);
    if (li) setLinkedinStatus("done");
    if (doc?.fileName) setDocFileName(doc.fileName);
    if (csv?.fileName) setCsvFileName(csv.fileName);
    if (csv) setCsvUploaded(true);
    if (crm || hubspotConnected) setCrmConnected(true);
    if (ideal?.rawContent) setIdealDescription(ideal.rawContent);
    if (dream?.rawContent) setDreamCompanies(dream.rawContent);
    if (comp?.rawContent) setCompetitors(comp.rawContent);
  }, [sourcesQuery.data, hubspotConnected]);

  // Auto-save text sources with debounce
  const saveTextSource = trpc.ingestion.saveTextSource.useMutation();
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const autoSaveText = (type: "ideal_customer" | "dream_companies" | "competitors", value: string) => {
    if (debounceRef.current[type]) clearTimeout(debounceRef.current[type]);
    debounceRef.current[type] = setTimeout(() => {
      saveTextSource.mutate({ type, content: value });
    }, 1000);
  };

  const hasWebsite = websiteStatus === "done" || !!websiteSource;
  const hasLinkedin = linkedinStatus === "done" || !!linkedinSource;
  const hasAnyInput = hasWebsite || websiteUrl.trim().length > 5 || hasLinkedin || csvUploaded || crmConnected || idealDescription.length > 20;
  const completedCount = [hasWebsite, hasLinkedin, csvUploaded, crmConnected, idealDescription.length > 20, dreamCompanies.length > 5].filter(Boolean).length;

  const analyzeUrlMutation = trpc.workspace.analyzeUrl.useMutation();

  const handleAnalyzeWebsite = () => {
    if (!websiteUrl.trim()) return;
    setWebsiteStatus("loading");
    // Two-track: save URL to workspace immediately + try full analysis
    analyzeUrlMutation.mutate(
      { url: websiteUrl },
      {
        onSuccess: (data) => {
          if ("error" in data && data.error) {
            // Scrape failed but URL is saved — still mark as done (partial)
            setWebsiteStatus("done");
            toast.info("Website saved. Analysis was partial — ICP will use what we have.");
          } else {
            setWebsiteStatus("done");
            toast.success("Website analyzed");
          }
        },
        onError: () => {
          // Even on error, mark as done so user can proceed
          setWebsiteStatus("done");
          toast.info("Website saved but couldn't be fully analyzed");
        },
      },
    );
    // Also save as ingestion source (non-blocking)
    processUrl.mutate({ type: "website", url: websiteUrl });
  };

  const handleAnalyzeLinkedin = () => {
    if (!linkedinUrl.trim()) return;
    setLinkedinStatus("loading");
    processUrl.mutate(
      { type: "linkedin_profile", url: linkedinUrl },
      {
        onSuccess: () => { setLinkedinStatus("done"); toast.success("LinkedIn added"); },
        onError: () => { setLinkedinStatus("done"); toast.info("LinkedIn saved"); },
      },
    );
  };

  const handleGenerate = () => {
    setIsGenerating(true);
    setIcpPhase("analyzing");

    // If URL entered but not yet analyzed, save it to workspace first
    if (websiteUrl.trim() && websiteStatus !== "done") {
      analyzeUrlMutation.mutate(
        { url: websiteUrl },
        {
          onSuccess: () => {
            setIcpPhase("inferring");
            inferMutation.mutate();
          },
          onError: () => {
            // Proceed anyway — ICP inference will work with whatever data exists
            setIcpPhase("inferring");
            inferMutation.mutate();
          },
        },
      );
    } else {
      setTimeout(() => {
        setIcpPhase("inferring");
        inferMutation.mutate();
      }, 600);
    }
  };

  return (
    <div className="min-h-screen bg-scopiq-mesh relative">
      <div className="absolute inset-0 bg-grid pointer-events-none" />

      <div className="relative">
        {/* Hero Header */}
        <div className="max-w-5xl mx-auto px-6 pt-16 pb-8 text-center">
          <h1
            className="hero-stagger text-4xl sm:text-5xl font-bold tracking-tight mb-4"
            style={{ animationDelay: "100ms" }}
          >
            Tell us about
            <br />
            <span className="gradient-text">your business</span>
          </h1>

          <p
            className="hero-stagger text-base text-muted-foreground max-w-lg mx-auto"
            style={{ animationDelay: "200ms" }}
          >
            The more you share, the more precise your ICP and TAM will be.
          </p>

          {/* Organic progress indicator */}
          <div className="hero-stagger flex items-center justify-center gap-2 mt-6" style={{ animationDelay: "300ms" }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={cn(
                  "h-1 rounded-full transition-all duration-500",
                  i < completedCount ? "w-8 bg-primary" : "w-4 bg-border",
                )}
              />
            ))}
            <span className="text-[10px] text-muted-foreground ml-2">
              {completedCount === 0 ? "Start with your website" : completedCount < 3 ? "Good start" : completedCount < 5 ? "Looking great" : "Maximum precision"}
            </span>
          </div>
        </div>

        {/* Content */}
        {isGenerating ? (
          <ProgressPanel icpPhase={icpPhase} tamProgress={tamProgress} />
        ) : (
          <div className="max-w-5xl mx-auto px-6 pb-16 space-y-8">
            {/* TIER 1 */}
            <TierSection title="The essentials" subtitle="What every founder has, even in stealth" delay={400}>
              <InputCard icon={<Globe className="size-5" />} label="Website or landing page" hint="Notion page, Carrd, anything works" complete={hasWebsite} delay={500} onRemove={websiteSource ? () => { deleteMutation.mutate({ sourceId: websiteSource.id }); setWebsiteUrl(""); setWebsiteStatus("idle"); } : undefined}>
                <div className="flex gap-2">
                  <Input placeholder="https://your-company.com" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAnalyzeWebsite()} disabled={websiteStatus === "loading"} className="h-10" />
                  <Button onClick={handleAnalyzeWebsite} disabled={!websiteUrl.trim() || websiteStatus === "loading"} className="btn-shine shrink-0">
                    {websiteStatus === "loading" ? <Spinner className="size-4 animate-spin" /> : "Analyze"}
                  </Button>
                </div>
              </InputCard>

              <InputCard icon={<LinkedinLogo className="size-5" weight="fill" />} label="Your LinkedIn profile" hint="Helps us understand your network and background" complete={hasLinkedin} delay={600} onRemove={linkedinSource ? () => { deleteMutation.mutate({ sourceId: linkedinSource.id }); setLinkedinUrl(""); setLinkedinStatus("idle"); } : undefined}>
                <div className="flex gap-2">
                  <Input placeholder="https://linkedin.com/in/your-name" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAnalyzeLinkedin()} disabled={linkedinStatus === "loading"} className="h-10" />
                  <Button variant="outline" onClick={handleAnalyzeLinkedin} disabled={!linkedinUrl.trim() || linkedinStatus === "loading"} className="shrink-0">
                    {linkedinStatus === "loading" ? <Spinner className="size-4 animate-spin" /> : "Add"}
                  </Button>
                </div>
              </InputCard>

              <InputCard icon={<FileText className="size-5" />} label="Pitch deck or one-pager" hint="PDF, PPTX, or DOCX — drag and drop" complete={!!docSource} delay={700} onRemove={docSource ? () => { deleteMutation.mutate({ sourceId: docSource.id }); setDocFileName(""); } : undefined}>
                <div
                  className="border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all hover:border-primary/40 hover:bg-primary/[0.02] active:scale-[0.99]"
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-primary/60", "bg-primary/5"); }}
                  onDragLeave={(e) => { e.currentTarget.classList.remove("border-primary/60", "bg-primary/5"); }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("border-primary/60", "bg-primary/5");
                    const file = e.dataTransfer.files?.[0];
                    if (!file) return;
                    setDocFileName(file.name);
                    const content = await file.text();
                    processUpload.mutate({ type: "document", fileName: file.name, content: content.slice(0, 500000) });
                  }}
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".pdf,.pptx,.docx,.txt";
                    input.onchange = async (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (!file) return;
                      setDocFileName(file.name);
                      const content = await file.text();
                      processUpload.mutate({ type: "document", fileName: file.name, content: content.slice(0, 500000) });
                    };
                    input.click();
                  }}
                >
                  {docFileName ? (
                    <>
                      <CheckCircle className="size-6 text-emerald-500 mx-auto mb-1" weight="fill" />
                      <p className="text-xs font-medium text-foreground">{docFileName}</p>
                    </>
                  ) : (
                    <>
                      <FileText className="size-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">Drop your file here or <span className="text-primary font-medium cursor-pointer">browse</span></p>
                    </>
                  )}
                </div>
              </InputCard>
            </TierSection>

            {/* TIER 2 */}
            <TierSection title="Tell us about your target" subtitle="Help the AI narrow down your ideal customer" defaultOpen={false} delay={800}>
              <InputCard icon={<Users className="size-5" />} label="Describe your ideal customer" hint="Be as specific as you can" complete={idealDescription.length > 20} delay={900} onRemove={idealSource ? () => { deleteMutation.mutate({ sourceId: idealSource.id }); setIdealDescription(""); } : undefined}>
                <textarea
                  placeholder="Ex: I target Head of Sales in B2B SaaS companies, Series A-B, 50-200 employees, in Western Europe..."
                  value={idealDescription}
                  onChange={(e) => { setIdealDescription(e.target.value); autoSaveText("ideal_customer", e.target.value); }}
                  rows={4}
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                />
              </InputCard>

              <InputCard icon={<Sparkle className="size-5" />} label="Dream customers" hint="3-5 companies you'd love to sell to" complete={dreamCompanies.length > 5} delay={1000} onRemove={dreamSource ? () => { deleteMutation.mutate({ sourceId: dreamSource.id }); setDreamCompanies(""); } : undefined}>
                <Input placeholder="Notion, Figma, Linear, Vercel..." value={dreamCompanies} onChange={(e) => { setDreamCompanies(e.target.value); autoSaveText("dream_companies", e.target.value); }} className="h-10" />
              </InputCard>

              <InputCard icon={<Lightning className="size-5" weight="fill" />} label="Known competitors" hint="Who else solves the same problem?" complete={competitors.length > 5} delay={1100} onRemove={competitorsSource ? () => { deleteMutation.mutate({ sourceId: competitorsSource.id }); setCompetitors(""); } : undefined}>
                <Input placeholder="Competitor A, Competitor B..." value={competitors} onChange={(e) => { setCompetitors(e.target.value); autoSaveText("competitors", e.target.value); }} className="h-10" />
              </InputCard>
            </TierSection>

            {/* TIER 3 */}
            <TierSection title="Power user" subtitle="More data = better ICP precision" defaultOpen={false} delay={1200}>
              <InputCard icon={<FileText className="size-5" />} label="CSV of beta users or customers" complete={csvUploaded || !!csvSource} delay={1300} onRemove={csvSource ? () => { deleteMutation.mutate({ sourceId: csvSource.id }); setCsvFileName(""); setCsvUploaded(false); } : undefined}>
                <div
                  className="border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all hover:border-primary/40"
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-primary/60", "bg-primary/5"); }}
                  onDragLeave={(e) => { e.currentTarget.classList.remove("border-primary/60", "bg-primary/5"); }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("border-primary/60", "bg-primary/5");
                    const file = e.dataTransfer.files?.[0];
                    if (!file) return;
                    setCsvFileName(file.name);
                    const content = await file.text();
                    processUpload.mutate({ type: "csv_customers", fileName: file.name, content }, { onSuccess: () => setCsvUploaded(true) });
                  }}
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".csv,.tsv";
                    input.onchange = async (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (!file) return;
                      setCsvFileName(file.name);
                      const content = await file.text();
                      processUpload.mutate({ type: "csv_customers", fileName: file.name, content }, { onSuccess: () => setCsvUploaded(true) });
                    };
                    input.click();
                  }}
                >
                  {csvFileName ? (
                    <>
                      <CheckCircle className="size-6 text-emerald-500 mx-auto mb-1" weight="fill" />
                      <p className="text-xs font-medium text-foreground">{csvFileName}</p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">Drop CSV here — company name, domain, industry, size</p>
                  )}
                </div>
              </InputCard>

              <InputCard icon={<Database className="size-5" />} label="CRM connection" hint="HubSpot Private App token" complete={crmConnected} delay={1400} onRemove={crmConnected ? () => { disconnectMutation.mutate({ type: "hubspot" }); setCrmConnected(false); } : undefined}>
                <CrmConnect onConnect={() => setCrmConnected(true)} />
              </InputCard>
            </TierSection>

            {/* CTA */}
            <div className="hero-stagger text-center pt-4" style={{ animationDelay: "600ms" }}>
              <button
                onClick={handleGenerate}
                disabled={!hasAnyInput || isGenerating}
                className={cn(
                  "inline-flex items-center gap-2.5 rounded-full px-10 py-4 text-base font-semibold text-white transition-all duration-300 btn-shine",
                  hasAnyInput ? "btn-gradient cursor-pointer hover:scale-[1.02] active:scale-[0.98]" : "bg-muted text-muted-foreground cursor-not-allowed",
                )}
              >
                <Rocket className="size-5" weight="fill" />
                {isGenerating ? "Building..." : "Generate my ICP"}
              </button>
              {!hasAnyInput && <p className="text-xs text-muted-foreground mt-3">Add your website URL to get started</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
