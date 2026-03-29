"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  MagnifyingGlass, Fire, Thermometer, Snowflake,
  Buildings, MapPin, Users, CaretDown, CaretUp,
  Export, ArrowsClockwise, Target, Funnel, Lightning,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc-client";

// ─── Constants ────────────────────────────────────

const ROW_HEIGHT = 36;
const PAGE_SIZE = 50;
const POLL_INTERVAL_MS = 3000;

const TIER_COLORS: Record<string, string> = {
  A: "bg-emerald-500", B: "bg-blue-500", C: "bg-amber-500", D: "bg-slate-400",
};

const HEAT_COLORS: Record<string, string> = {
  Burning: "text-orange-500", Hot: "text-rose-500", Warm: "text-amber-500", Cold: "text-slate-400",
};

// ─── Helpers ──────────────────────────────────────

function formatEmployees(n: number | null | undefined): string {
  if (!n) return "—";
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function HeatIcon({ heat }: { heat: string | null }) {
  const cls = "size-3";
  switch (heat) {
    case "Burning": case "Hot": return <Fire weight="fill" className={cls} />;
    case "Warm": return <Thermometer weight="fill" className={cls} />;
    default: return <Snowflake weight="fill" className={cls} />;
  }
}

const AVATAR_COLORS = [
  "bg-teal-500", "bg-blue-500", "bg-orange-500", "bg-rose-500",
  "bg-violet-500", "bg-emerald-500", "bg-amber-500", "bg-indigo-500",
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
  return Math.abs(h);
}

function CompanyIcon({ name, domain }: { name: string; domain?: string | null }) {
  const [useFallback, setUseFallback] = useState(false);
  const letter = (name || "?")[0]?.toUpperCase() ?? "?";
  const color = AVATAR_COLORS[hashStr(name || "?") % AVATAR_COLORS.length];
  const guessedDomain = domain || `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;

  if (useFallback) {
    return (
      <div className={cn("size-6 rounded flex items-center justify-center text-white text-[10px] font-bold shrink-0", color)}>
        {letter}
      </div>
    );
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(guessedDomain)}&sz=64`}
      className="size-6 rounded object-contain bg-white border border-border/30 shrink-0"
      loading="lazy"
      onError={() => setUseFallback(true)}
      alt=""
    />
  );
}

// ─── Export Button ────────────────────────────────

function ExportButton({ tamBuildId, tierFilter, search, totalFiltered }: {
  tamBuildId: string; tierFilter: string[]; search: string; totalFiltered: number;
}) {
  const [exporting, setExporting] = useState(false);
  const exportQuery = trpc.tam.exportAccounts.useQuery(
    {
      tamBuildId,
      tier: tierFilter.length > 0 ? tierFilter : undefined,
      search: search || undefined,
      sortBy: "heatScore",
      sortOrder: "desc" as const,
    },
    { enabled: exporting },
  );

  useEffect(() => {
    if (exporting && exportQuery.data) {
      const rows = exportQuery.data.accounts;
      const csv = [
        ["Name", "Domain", "Industry", "Employees", "Tier", "Heat", "Score", "Country", "City"].join(","),
        ...rows.map((a: Record<string, unknown>) => [
          `"${String(a.name ?? "").replace(/"/g, '""')}"`,
          a.domain ?? "", `"${String(a.industry ?? "").replace(/"/g, '""')}"`,
          a.employeeCount ?? "", a.tier ?? "", a.heat ?? "", a.heatScore ?? "",
          `"${String(a.country ?? "").replace(/"/g, '""')}"`,
          `"${String(a.city ?? "").replace(/"/g, '""')}"`,
        ].join(",")),
      ].join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `scopiq-tam-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setExporting(false);
    }
  }, [exporting, exportQuery.data]);

  if (totalFiltered === 0) return null;

  return (
    <Button
      variant="ghost" size="sm" className="text-xs h-7 gap-1 px-2 ml-auto"
      disabled={exporting}
      onClick={() => setExporting(true)}
    >
      {exporting ? <ArrowsClockwise className="size-3 animate-spin" /> : <Export className="size-3" />}
      Export{totalFiltered > 50 ? ` ${totalFiltered}` : ""}
    </Button>
  );
}

// ─── Expand Market Button ─────────────────────────

function ExpandButton({ tamBuildId }: { tamBuildId: string }) {
  const loadMore = trpc.tam.loadMore.useMutation();

  return (
    <Button
      variant="outline" size="sm" className="text-xs h-7 gap-1"
      disabled={loadMore.isPending}
      onClick={() => loadMore.mutate({ tamBuildId, pages: 10 })}
    >
      {loadMore.isPending ? (
        <><ArrowsClockwise className="size-3 animate-spin" /> Expanding...</>
      ) : (
        <><CaretDown className="size-3" /> Expand market</>
      )}
    </Button>
  );
}

// ─── Account Expand Panel ─────────────────────────

interface SignalData {
  name: string;
  detected: boolean;
  evidence: string;
  reasoning: string;
  sources: Array<{ url: string; title: string }>;
  points: number;
}

function AccountExpandPanel({ account, tamBuildId }: {
  account: Record<string, unknown>;
  tamBuildId: string;
}) {
  const contactsQuery = trpc.tam.getLeads.useQuery({
    tamBuildId,
    tamAccountId: account.id as string,
    limit: 10,
  });

  const contacts = (contactsQuery.data?.leads ?? []) as Array<Record<string, unknown>>;
  const signals = (account.signals ?? []) as SignalData[];
  const detectedSignals = signals.filter((s) => s.detected);

  // Recommended action
  const connectionNames = (account.connectionNames ?? []) as string[];
  const hasConnection = connectionNames.length > 0;
  const hasFunding = !!(account as Record<string, boolean>).fundedSignal;
  const hasHiring = !!(account as Record<string, boolean>).hiringSignal;

  const recommendation = hasConnection
    ? `Warm intro via ${connectionNames[0]}`
    : hasFunding
      ? "Reference their recent funding in outreach"
      : hasHiring
        ? "Mention their team growth"
        : "Cold outreach — lead with value prop";

  return (
    <div className="px-4 py-3 bg-muted/20 border-b animate-fade-in-up">
      <div className="grid grid-cols-3 gap-4 max-w-5xl">
        {/* Signals */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Signals</p>
          {detectedSignals.length > 0 ? (
            <div className="space-y-1.5">
              {detectedSignals.map((s) => (
                <div key={s.name} className="flex items-start gap-2">
                  <Lightning className="size-3 text-amber-500 mt-0.5 shrink-0" weight="fill" />
                  <div>
                    <p className="text-[11px] font-medium text-foreground">{s.name} <span className="text-emerald-600">+{s.points}pts</span></p>
                    <p className="text-[10px] text-muted-foreground">{s.evidence}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground italic">No signals detected yet</p>
          )}
          <div className="mt-3 p-2 rounded-md bg-primary/5 border border-primary/10">
            <p className="text-[10px] font-medium text-primary">{recommendation}</p>
          </div>
        </div>

        {/* Contacts */}
        <div className="col-span-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Contacts ({contacts.length})
          </p>
          {contactsQuery.isLoading ? (
            <p className="text-[10px] text-muted-foreground">Loading contacts...</p>
          ) : contacts.length > 0 ? (
            <div className="space-y-1">
              {contacts.map((c: Record<string, unknown>) => (
                <div key={c.id as string} className="flex items-center gap-3 py-1 px-2 rounded hover:bg-muted/50">
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] font-medium text-foreground">
                      {c.firstName as string} {c.lastName as string}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-2">{c.title as string}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[9px]">
                    {c.hasEmail ? (
                      <span className="text-emerald-600">Email available</span>
                    ) : (
                      <span className="text-muted-foreground/50">No email</span>
                    )}
                    {!!c.hasDirectPhone && <span className="text-emerald-600">Phone</span>}
                    {c.linkedinUrl ? (
                      <a href={c.linkedinUrl as string} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        LinkedIn
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground italic">No contacts loaded for this account</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────

export default function MarketPage() {
  const router = useRouter();
  const parentRef = useRef<HTMLDivElement>(null);

  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("heatScore");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"accounts" | "contacts">("accounts");

  // Load ICP for banner
  const icpQuery = trpc.icp.getActive.useQuery();
  const icpData = icpQuery.data?.data as Record<string, unknown> | null;

  // Load latest build
  const buildQuery = trpc.tam.getLatestBuild.useQuery();
  const build = buildQuery.data;
  const tamBuildId = build?.id;
  const isBuilding = build?.status !== "complete" && build?.status !== "failed" && !!build;

  // Poll during build
  const buildPoll = trpc.tam.getBuildStatus.useQuery(
    { tamBuildId: tamBuildId ?? "" },
    { enabled: !!tamBuildId && isBuilding, refetchInterval: POLL_INTERVAL_MS },
  );

  // Load accounts
  const accountsQuery = trpc.tam.getAccounts.useQuery(
    {
      tamBuildId: tamBuildId ?? "",
      offset: 0,
      limit: 200,
      tier: tierFilter.length > 0 ? tierFilter : undefined,
      search: search || undefined,
      sortBy,
      sortOrder,
    },
    { enabled: !!tamBuildId },
  );

  const accounts = accountsQuery.data?.accounts ?? [];
  const totalFiltered = accountsQuery.data?.totalFiltered ?? 0;

  // Load contacts for flat view
  const contactsQuery = trpc.tam.getLeads.useQuery(
    { tamBuildId: tamBuildId ?? "", limit: 200, sortBy: "heatScore", sortOrder: "desc" },
    { enabled: !!tamBuildId && viewMode === "contacts" },
  );
  const contactsList = (contactsQuery.data?.leads ?? []) as Array<Record<string, unknown>>;

  // Virtual scrolling
  const itemCount = viewMode === "accounts" ? accounts.length : contactsList.length;
  const rowVirtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "desc" ? "asc" : "desc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return null;
    return sortOrder === "desc"
      ? <CaretDown className="size-2.5" />
      : <CaretUp className="size-2.5" />;
  };

  // Refetch accounts periodically during build (must be before any conditional return)
  const buildPhase = buildPoll.data?.phase ?? build?.phase;
  const buildLoaded = buildPoll.data?.loadedCount ?? build?.loadedCount ?? 0;
  const buildTotal = buildPoll.data?.totalCount ?? build?.totalCount ?? 0;
  const buildScored = buildPoll.data?.scoredCount ?? build?.scoredCount ?? 0;

  useEffect(() => {
    if (!isBuilding) return;
    const interval = setInterval(() => {
      accountsQuery.refetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBuilding]);

  // No build state
  if (!build) {
    if (buildQuery.isLoading) {
      return (
        <div className="flex items-center justify-center h-screen">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <Buildings className="size-12 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No TAM built yet</p>
        <Button onClick={() => router.push("/icp")}>Define ICP first</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Build progress bar */}
      {isBuilding && (
        <div className="border-b bg-primary/5 px-4 py-2 flex items-center gap-3 shrink-0">
          <ArrowsClockwise className="size-3.5 text-primary animate-spin shrink-0" />
          <p className="text-xs text-foreground font-medium capitalize">
            {buildPhase?.replace(/-/g, " ")}...
          </p>
          {buildTotal > 0 && (
            <>
              <div className="flex-1 max-w-xs h-1.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((buildLoaded / buildTotal) * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {buildLoaded}/{buildTotal} loaded · {buildScored} scored
              </span>
            </>
          )}
        </div>
      )}

      {/* ICP Banner */}
      {icpData && (
        <div className="border-b px-4 py-1.5 bg-muted/30 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Target className="size-3.5 text-primary shrink-0" weight="duotone" />
            <span className="text-[10px] font-medium text-muted-foreground">ICP:</span>
            {(icpData.roles as Array<{ title: string }> | undefined)?.slice(0, 3).map((r) => (
              <span key={r.title} className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-700 font-medium">{r.title}</span>
            ))}
            {(icpData.industries as string[] | undefined)?.slice(0, 3).map((ind) => (
              <span key={ind} className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-700 font-medium">{ind}</span>
            ))}
            {(icpData.employeeRange as { min: number; max: number } | undefined) && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 font-medium">
                {(icpData.employeeRange as { min: number; max: number }).min}-{(icpData.employeeRange as { min: number; max: number }).max} emp
              </span>
            )}
            {(icpData.geographies as string[] | undefined)?.slice(0, 2).map((g) => (
              <span key={g} className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-700 font-medium">{g}</span>
            ))}
            <button onClick={() => router.push("/icp")} className="text-[10px] text-primary hover:underline ml-1">Edit</button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="border-b px-4 py-2 flex items-center gap-3 shrink-0 bg-card">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder='Search accounts... try "hiring tier a" or "funded startups"'
            className="pl-8 h-8 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* View toggle */}
        <div className="flex rounded-md border text-[10px] font-medium overflow-hidden">
          <button
            onClick={() => setViewMode("accounts")}
            className={cn("px-2.5 py-1 transition-colors", viewMode === "accounts" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}
          >
            Companies
          </button>
          <button
            onClick={() => setViewMode("contacts")}
            className={cn("px-2.5 py-1 transition-colors border-l", viewMode === "contacts" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}
          >
            Contacts
          </button>
        </div>

        {/* Tier filter pills */}
        <div className="flex gap-1">
          {["A", "B", "C", "D"].map((tier) => (
            <button
              key={tier}
              onClick={() =>
                setTierFilter((prev) =>
                  prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier],
                )
              }
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors border",
                tierFilter.includes(tier)
                  ? "bg-foreground text-background border-foreground"
                  : "bg-transparent text-muted-foreground border-border hover:border-foreground/30",
              )}
            >
              <span className={cn("size-2 rounded-full", TIER_COLORS[tier])} />
              {tier}
            </button>
          ))}
        </div>

        <span className="text-[10px] text-muted-foreground tabular-nums">
          {totalFiltered.toLocaleString()} accounts
        </span>

        <ExportButton tamBuildId={tamBuildId!} tierFilter={tierFilter} search={search} totalFiltered={totalFiltered} />
        <ExpandButton tamBuildId={tamBuildId!} />
      </div>

      {/* Table Header */}
      {viewMode === "accounts" ? (
        <div className="grid grid-cols-[2fr_1fr_80px_1fr_60px_60px_60px_40px] gap-px px-4 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b bg-muted/30 shrink-0">
          <button className="text-left flex items-center gap-1" onClick={() => toggleSort("name")}>Company <SortIcon field="name" /></button>
          <button className="text-left flex items-center gap-1" onClick={() => toggleSort("industry")}>Industry <SortIcon field="industry" /></button>
          <button className="text-left flex items-center gap-1" onClick={() => toggleSort("employeeCount")}>Size <SortIcon field="employeeCount" /></button>
          <span>Location</span>
          <button className="text-center flex items-center gap-1 justify-center" onClick={() => toggleSort("tier")}>Tier <SortIcon field="tier" /></button>
          <span className="text-center">Heat</span>
          <button className="text-right flex items-center gap-1 justify-end" onClick={() => toggleSort("heatScore")}>Score <SortIcon field="heatScore" /></button>
          <span className="text-center">Sig</span>
        </div>
      ) : (
        <div className="grid grid-cols-[1.5fr_1fr_1.5fr_1fr_80px_80px_60px] gap-px px-4 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b bg-muted/30 shrink-0">
          <span>Name</span>
          <span>Title</span>
          <span>Company</span>
          <span>Industry</span>
          <span className="text-center">Email</span>
          <span className="text-center">Phone</span>
          <span className="text-center">Score</span>
        </div>
      )}

      {/* Virtual Scrolled Rows */}
      <div ref={parentRef} className="flex-1 overflow-auto scrollbar-thin">
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
          {viewMode === "contacts" ? (
            // ── Contact Flat View ──
            rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const c = contactsList[virtualRow.index];
              if (!c) return null;
              return (
                <div
                  key={c.id as string}
                  className="absolute inset-x-0 grid grid-cols-[1.5fr_1fr_1.5fr_1fr_80px_80px_60px] gap-px px-4 items-center row-hover border-b border-border/30"
                  style={{ height: `${ROW_HEIGHT}px`, transform: `translateY(${virtualRow.start}px)` }}
                >
                  <span className="text-xs font-medium text-foreground truncate">
                    {c.firstName as string} {c.lastName as string}
                  </span>
                  <span className="text-[11px] text-muted-foreground truncate">{c.title as string}</span>
                  <span className="text-[11px] text-muted-foreground truncate">{c.companyName as string}</span>
                  <span className="text-[10px] text-muted-foreground truncate">{(c.companyIndustry as string) ?? "—"}</span>
                  <div className="flex justify-center">
                    {c.hasEmail ? (
                      <span className="text-[9px] text-emerald-600 font-medium">Available</span>
                    ) : (
                      <span className="text-[9px] text-muted-foreground/40">—</span>
                    )}
                  </div>
                  <div className="flex justify-center">
                    {c.hasDirectPhone ? (
                      <span className="text-[9px] text-emerald-600 font-medium">Available</span>
                    ) : (
                      <span className="text-[9px] text-muted-foreground/40">—</span>
                    )}
                  </div>
                  <span className="text-[11px] text-right tabular-nums font-medium">{c.heatScore as number}</span>
                </div>
              );
            })
          ) : (
            // ── Account View ──
            rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const account = accounts[virtualRow.index];
            if (!account) return null;

            const signalCount = [
              account.hiringSignal, account.fundedSignal, account.keywordMatch,
            ].filter(Boolean).length;

            const isExpanded = expandedId === account.id;

            return (
              <div
                key={account.id}
                className="absolute inset-x-0"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
              <div
                className="grid grid-cols-[2fr_1fr_80px_1fr_60px_60px_60px_40px] gap-px px-4 items-center row-hover cursor-pointer border-b border-border/30"
                onClick={() => setExpandedId(isExpanded ? null : account.id)}
                style={{
                  height: `${ROW_HEIGHT}px`,
                }}
              >
                {/* Company */}
                <div className="flex items-center gap-2 min-w-0">
                  <CompanyIcon name={account.name} domain={account.domain} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{account.name}</p>
                    {account.domain && (
                      <p className="text-[10px] text-muted-foreground truncate">{account.domain}</p>
                    )}
                  </div>
                </div>

                {/* Industry */}
                <span className="text-[11px] text-muted-foreground truncate">{account.industry ?? "—"}</span>

                {/* Size */}
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {formatEmployees(account.employeeCount)}
                </span>

                {/* Location */}
                <span className="text-[10px] text-muted-foreground truncate">
                  {[account.city, account.country].filter(Boolean).join(", ") || "—"}
                </span>

                {/* Tier */}
                <div className="flex justify-center">
                  {account.tier && (
                    <span className={cn(
                      "size-5 rounded text-white text-[9px] font-bold flex items-center justify-center",
                      TIER_COLORS[account.tier] ?? "bg-slate-400",
                    )}>
                      {account.tier}
                    </span>
                  )}
                </div>

                {/* Heat */}
                <div className="flex items-center justify-center gap-0.5">
                  <span className={HEAT_COLORS[account.heat ?? ""] ?? "text-slate-400"}>
                    <HeatIcon heat={account.heat ?? null} />
                  </span>
                </div>

                {/* Score */}
                <span className="text-[11px] text-right tabular-nums font-medium text-foreground">
                  {account.heatScore}
                </span>

                {/* Signals */}
                <div className="flex justify-center">
                  {signalCount > 0 && (
                    <span className="flex items-center gap-0.5 text-[9px] text-amber-600">
                      <Lightning className="size-3" weight="fill" />
                      {signalCount}
                    </span>
                  )}
                </div>
              </div>
              {isExpanded && (
                <AccountExpandPanel account={account as unknown as Record<string, unknown>} tamBuildId={tamBuildId!} />
              )}
              </div>
            );
          })
          )}
        </div>
      </div>
    </div>
  );
}
