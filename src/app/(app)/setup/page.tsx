"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
        <div className="space-y-4 animate-fade-in-up">
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
  children,
  delay = 0,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  complete?: boolean;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <div
      className={cn(
        "hero-stagger relative rounded-2xl border bg-card/80 backdrop-blur-sm p-5 transition-all duration-300 input-glow",
        complete
          ? "border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/10"
          : "border-border/50 hover:border-border hover:shadow-md",
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex items-center justify-center size-10 rounded-xl shrink-0 transition-colors",
            complete
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-muted/80 text-muted-foreground",
          )}
        >
          {complete ? (
            <CheckCircle className="size-5 animate-check-pop" weight="fill" />
          ) : (
            icon
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{label}</h3>
            {complete && (
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600">
                Done
              </span>
            )}
          </div>
          {hint && !complete && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>
          )}
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Progress Panel (ICP + TAM build) ──────────

const BUILD_PHASES = [
  { id: "analyzing", label: "Analyzing your data sources", icon: MagnifyingGlass },
  { id: "inferring", label: "Generating ICP with AI", icon: Sparkle },
  { id: "done-icp", label: "ICP ready", icon: CheckCircle },
  { id: "counting", label: "Counting your market", icon: ChartBar },
  { id: "loading-top", label: "Loading top accounts", icon: MagnifyingGlass },
  { id: "scoring", label: "Scoring accounts", icon: ChartBar },
  { id: "complete", label: "TAM build complete", icon: CheckCircle },
];

function ProgressPanel({ icpPhase, tamProgress }: { icpPhase: string; tamProgress: BuildProgress | null }) {
  const currentId = tamProgress?.phase ?? icpPhase;
  const currentIdx = BUILD_PHASES.findIndex((p) => p.id === currentId);

  return (
    <div className="max-w-md mx-auto mt-12 hero-stagger" style={{ animationDelay: "0ms" }}>
      <div className="rounded-2xl border bg-card/80 backdrop-blur-sm p-8 glow-teal">
        <div className="flex items-center gap-3 mb-6">
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center animate-pulse-ring">
            <Sparkle className="size-5 text-primary" weight="fill" />
          </div>
          <div>
            <h3 className="text-base font-heading font-semibold">Building your market intelligence</h3>
            <p className="text-xs text-muted-foreground">This takes 30-60 seconds</p>
          </div>
        </div>

        <div className="space-y-3">
          {BUILD_PHASES.map((phase, i) => {
            const Icon = phase.icon;
            const isCurrent = phase.id === currentId;
            const isPast = i < currentIdx;

            return (
              <div key={phase.id} className={cn(
                "flex items-center gap-3 text-sm transition-all duration-300",
                isCurrent ? "text-foreground font-medium" : isPast ? "text-emerald-600" : "text-muted-foreground/40",
              )}>
                {isCurrent ? (
                  <Spinner className="size-4 animate-spin text-primary shrink-0" />
                ) : isPast ? (
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
          <div className="mt-4 pt-4 border-t text-xs text-muted-foreground tabular-nums">
            {tamProgress.data.loadedCount} accounts loaded
            {tamProgress.data.totalCount ? ` / ${tamProgress.data.totalCount} total` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Inline CRM Connect ────────────────────────

function CrmConnect({ onConnect }: { onConnect: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const connectMutation = trpc.integration.connect.useMutation();
  const processUpload = trpc.ingestion.processUpload.useMutation();

  const handleConnect = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    try {
      await connectMutation.mutateAsync({ type: "hubspot", apiKey: apiKey.trim() });
      const res = await fetch(
        "https://api.hubapi.com/crm/v3/objects/companies?limit=100&properties=name,domain,industry,numberofemployees,country",
        { headers: { Authorization: `Bearer ${apiKey.trim()}` } },
      );
      if (res.ok) {
        const data = await res.json();
        const companies = data.results ?? [];
        if (companies.length > 0) {
          const csvLines = ["company,domain,industry,employees,country"];
          for (const c of companies) {
            const p = c.properties ?? {};
            csvLines.push([p.name ?? "", p.domain ?? "", p.industry ?? "", p.numberofemployees ?? "", p.country ?? ""].map((v: string) => `"${v}"`).join(","));
          }
          processUpload.mutate({ type: "csv_customers", fileName: "hubspot.csv", content: csvLines.join("\n") });
        }
        toast.success(`Pulled ${companies.length} companies from HubSpot`);
        onConnect();
      } else {
        toast.error("Invalid HubSpot token");
      }
    } catch {
      toast.error("Connection failed");
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

  if (tamProgress?.type === "complete") {
    setTimeout(() => router.push("/market"), 1500);
  }

  // Check completed sources
  const sources = (sourcesQuery.data ?? []) as Array<{ type: string; status: string }>;
  const hasWebsite = websiteStatus === "done" || sources.some((s) => s.type === "website" && s.status === "complete");
  const hasLinkedin = linkedinStatus === "done" || sources.some((s) => s.type === "linkedin_profile" && s.status === "complete");
  const completedCount = [hasWebsite, hasLinkedin, csvUploaded, crmConnected, idealDescription.length > 20, dreamCompanies.length > 5].filter(Boolean).length;

  const handleAnalyzeWebsite = () => {
    if (!websiteUrl.trim()) return;
    setWebsiteStatus("loading");
    processUrl.mutate(
      { type: "website", url: websiteUrl },
      {
        onSuccess: (d) => setWebsiteStatus(d.status === "complete" ? "done" : "error"),
        onError: () => setWebsiteStatus("error"),
      },
    );
  };

  const handleAnalyzeLinkedin = () => {
    if (!linkedinUrl.trim()) return;
    setLinkedinStatus("loading");
    processUrl.mutate(
      { type: "linkedin_profile", url: linkedinUrl },
      {
        onSuccess: (d) => setLinkedinStatus(d.status === "complete" ? "done" : "error"),
        onError: () => setLinkedinStatus("error"),
      },
    );
  };

  const handleGenerate = () => {
    setIsGenerating(true);
    setIcpPhase("analyzing");
    setTimeout(() => {
      setIcpPhase("inferring");
      inferMutation.mutate();
    }, 800);
  };

  return (
    <div className="min-h-screen bg-scopiq-mesh relative">
      <div className="absolute inset-0 bg-grid pointer-events-none" />

      <div className="relative">
        {/* Hero Header */}
        <div className="max-w-2xl mx-auto px-6 pt-16 pb-8 text-center">
          <div className="hero-stagger" style={{ animationDelay: "0ms" }}>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/60 backdrop-blur-sm px-4 py-1.5 text-sm text-muted-foreground mb-6">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              AI-Powered TAM Engine
            </div>
          </div>

          <h1
            className="hero-stagger text-4xl sm:text-5xl font-bold tracking-tight mb-4"
            style={{ animationDelay: "100ms" }}
          >
            Tell us about
            <br />
            <span className="gradient-text">your business</span>
          </h1>

          <p
            className="hero-stagger text-base text-muted-foreground max-w-md mx-auto"
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
          <div className="max-w-2xl mx-auto px-6 pb-16 space-y-8">
            {/* TIER 1 */}
            <TierSection title="The essentials" subtitle="What every founder has, even in stealth" delay={400}>
              <InputCard icon={<Globe className="size-5" />} label="Website or landing page" hint="Notion page, Carrd, anything works" complete={hasWebsite} delay={500}>
                <div className="flex gap-2">
                  <Input placeholder="https://your-company.com" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAnalyzeWebsite()} disabled={websiteStatus === "loading"} className="h-10" />
                  <Button onClick={handleAnalyzeWebsite} disabled={!websiteUrl.trim() || websiteStatus === "loading"} className="btn-shine shrink-0">
                    {websiteStatus === "loading" ? <Spinner className="size-4 animate-spin" /> : "Analyze"}
                  </Button>
                </div>
              </InputCard>

              <InputCard icon={<LinkedinLogo className="size-5" weight="fill" />} label="Your LinkedIn profile" hint="Helps us understand your network and background" complete={hasLinkedin} delay={600}>
                <div className="flex gap-2">
                  <Input placeholder="https://linkedin.com/in/your-name" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAnalyzeLinkedin()} disabled={linkedinStatus === "loading"} className="h-10" />
                  <Button variant="outline" onClick={handleAnalyzeLinkedin} disabled={!linkedinUrl.trim() || linkedinStatus === "loading"} className="shrink-0">
                    {linkedinStatus === "loading" ? <Spinner className="size-4 animate-spin" /> : "Add"}
                  </Button>
                </div>
              </InputCard>

              <InputCard icon={<FileText className="size-5" />} label="Pitch deck or one-pager" hint="PDF, PPTX, or DOCX — drag and drop" complete={sources.some((s) => s.type === "document" && s.status === "complete")} delay={700}>
                <div
                  className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all hover:border-primary/40 hover:bg-primary/[0.02] active:scale-[0.99]"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".pdf,.pptx,.docx,.txt";
                    input.onchange = async (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (!file) return;
                      const content = await file.text();
                      processUpload.mutate({ type: "document", fileName: file.name, content: content.slice(0, 500000) });
                    };
                    input.click();
                  }}
                >
                  <FileText className="size-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">Drop your file here or <span className="text-primary font-medium cursor-pointer">browse</span></p>
                </div>
              </InputCard>
            </TierSection>

            {/* TIER 2 */}
            <TierSection title="Refine your target" subtitle="Help the AI narrow down your ideal customer" defaultOpen={false} delay={800}>
              <InputCard icon={<Users className="size-5" />} label="Describe your ideal customer" hint="Be as specific as you can" complete={idealDescription.length > 20} delay={900}>
                <textarea
                  placeholder="Ex: I target Head of Sales in B2B SaaS companies, Series A-B, 50-200 employees, in Western Europe..."
                  value={idealDescription}
                  onChange={(e) => setIdealDescription(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                />
              </InputCard>

              <InputCard icon={<Sparkle className="size-5" />} label="Dream customers" hint="3-5 companies you'd love to sell to" complete={dreamCompanies.length > 5} delay={1000}>
                <Input placeholder="Notion, Figma, Linear, Vercel..." value={dreamCompanies} onChange={(e) => setDreamCompanies(e.target.value)} className="h-10" />
              </InputCard>

              <InputCard icon={<Lightning className="size-5" weight="fill" />} label="Known competitors" hint="Who else solves the same problem?" complete={competitors.length > 5} delay={1100}>
                <Input placeholder="Competitor A, Competitor B..." value={competitors} onChange={(e) => setCompetitors(e.target.value)} className="h-10" />
              </InputCard>
            </TierSection>

            {/* TIER 3 */}
            <TierSection title="Power user" subtitle="More data = better ICP precision" defaultOpen={false} delay={1200}>
              <InputCard icon={<FileText className="size-5" />} label="CSV of beta users or customers" complete={csvUploaded || sources.some((s) => s.type === "csv_customers" && s.status === "complete")} delay={1300}>
                <div
                  className="border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all hover:border-primary/40"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".csv,.tsv";
                    input.onchange = async (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (!file) return;
                      const content = await file.text();
                      processUpload.mutate({ type: "csv_customers", fileName: file.name, content }, { onSuccess: () => setCsvUploaded(true) });
                    };
                    input.click();
                  }}
                >
                  <p className="text-xs text-muted-foreground">Drop CSV here — company name, domain, industry, size</p>
                </div>
              </InputCard>

              <InputCard icon={<Database className="size-5" />} label="CRM connection" hint="HubSpot Private App token" complete={crmConnected} delay={1400}>
                <CrmConnect onConnect={() => setCrmConnected(true)} />
              </InputCard>
            </TierSection>

            {/* CTA */}
            <div className="hero-stagger text-center pt-4" style={{ animationDelay: "600ms" }}>
              <button
                onClick={handleGenerate}
                disabled={!hasWebsite || isGenerating}
                className={cn(
                  "inline-flex items-center gap-2.5 rounded-full px-10 py-4 text-base font-semibold text-white transition-all duration-300 btn-shine",
                  hasWebsite ? "btn-gradient cursor-pointer hover:scale-[1.02] active:scale-[0.98]" : "bg-muted text-muted-foreground cursor-not-allowed",
                )}
              >
                <Rocket className="size-5" weight="fill" />
                {isGenerating ? "Building..." : "Generate my ICP"}
              </button>
              {!hasWebsite && <p className="text-xs text-muted-foreground mt-3">Add your website URL to get started</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
