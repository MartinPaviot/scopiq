"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Target, ArrowRight, ArrowsClockwise, PencilSimple, FloppyDisk, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfidenceBar } from "@/components/icp/confidence-bar";
import { TagEditor } from "@/components/icp/tag-editor";
import { RangeEditor } from "@/components/icp/range-editor";
import { trpc } from "@/lib/trpc-client";
import { toast } from "sonner";

interface IcpRole {
  title: string;
  variations?: string[];
  seniority?: string;
  why?: string;
}

interface BuyingSignal {
  name: string;
  detectionMethod?: string;
  why?: string;
  strength?: string;
}

interface EmployeeRange {
  min: number;
  max: number;
  sweetSpot?: number;
}

interface Confidence {
  industry?: number;
  size?: number;
  title?: number;
  geo?: number;
  overall?: number;
}

function TagList({ items, color }: { items: string[]; color: string }) {
  if (items.length === 0) return <span className="text-xs text-muted-foreground italic">None detected</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span key={item} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${color}`}>
          {item}
        </span>
      ))}
    </div>
  );
}

function Section({
  title,
  confidence,
  children,
}: {
  title: string;
  confidence?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {confidence !== undefined && (
          <div className="w-32">
            <ConfidenceBar value={confidence} />
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export default function IcpPage() {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, unknown> | null>(null);

  const icpQuery = trpc.icp.getActive.useQuery();
  const apolloQuery = trpc.icp.getApolloPreview.useQuery();
  const workspaceQuery = trpc.workspace.getSettings.useQuery();
  const proposalsQuery = trpc.icp.getProposals.useQuery();

  const updateMutation = trpc.icp.update.useMutation({
    onSuccess: () => {
      toast.success("ICP updated");
      setEditing(false);
      setEditData(null);
      icpQuery.refetch();
      apolloQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const respondMutation = trpc.icp.respondToProposal.useMutation({
    onSuccess: () => {
      toast.success("Proposal processed");
      proposalsQuery.refetch();
      icpQuery.refetch();
    },
  });

  const tamMutation = trpc.tam.startBuild.useMutation({
    onSuccess: () => {
      toast.success("TAM build started!");
      router.push("/market");
    },
    onError: (err) => toast.error(err.message),
  });

  const icp = icpQuery.data;
  const companyUrl = (workspaceQuery.data as Record<string, string> | undefined)?.companyUrl ?? "";
  const proposals = (proposalsQuery.data ?? []) as Array<{ id: string; changes: unknown; sampleSize: number; createdAt: string }>;

  const startEditing = () => {
    if (!icp?.data) return;
    setEditData({ ...icp.data });
    setEditing(true);
  };

  const saveEdits = () => {
    if (!icp?.id || !editData) return;
    updateMutation.mutate({
      profileId: icp.id,
      industries: editData.industries,
      geographies: editData.geographies,
      keywords: editData.keywords,
      competitors: editData.competitors,
      disqualifiers: editData.disqualifiers,
      employeeRange: editData.employeeRange,
    });
  };

  const updateField = (field: string, value: unknown) => {
    setEditData((prev) => prev ? { ...prev, [field]: value } : null);
  };

  if (icpQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-sm text-muted-foreground">Loading ICP...</div>
      </div>
    );
  }

  if (!icp?.data) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <Target className="size-12 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No ICP generated yet</p>
        <Button onClick={() => router.push("/setup")}>Go to Setup</Button>
      </div>
    );
  }

  const d = icp.data;
  const conf = (d.confidence ?? {}) as Confidence;
  const roles = (d.roles ?? []) as IcpRole[];
  const signals = (d.buyingSignals ?? []) as BuyingSignal[];
  const empRange = (d.employeeRange ?? { min: 0, max: 10000 }) as EmployeeRange;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
              <Target className="size-5 text-primary" weight="duotone" />
              Ideal Customer Profile
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Version {icp.version} · {icp.source} · Overall confidence:{" "}
              <span className="font-semibold">{Math.round((conf.overall ?? 0) * 100)}%</span>
            </p>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button variant="outline" size="sm" onClick={() => { setEditing(false); setEditData(null); }}>
                  <X className="size-3.5" /> Cancel
                </Button>
                <Button size="sm" onClick={saveEdits} disabled={updateMutation.isPending}>
                  <FloppyDisk className="size-3.5" />
                  {updateMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={startEditing}>
                  <PencilSimple className="size-3.5" /> Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => router.push("/setup")}>
                  <ArrowsClockwise className="size-3.5" /> Regenerate
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => tamMutation.mutate({ siteUrl: companyUrl || "https://example.com" })}
                  disabled={tamMutation.isPending}
                >
                  {tamMutation.isPending ? "Building..." : "Build TAM"}
                  <ArrowRight className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ICP Grid */}
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        {/* Roles */}
        <Section title="Target Roles" confidence={conf.title}>
          <div className="space-y-1.5">
            {roles.map((role, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground">{role.title}</span>
                {role.seniority && (
                  <Badge variant="secondary" className="text-[9px] py-0 h-4">{role.seniority}</Badge>
                )}
                {role.variations && role.variations.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    ({role.variations.slice(0, 3).join(", ")})
                  </span>
                )}
              </div>
            ))}
          </div>
        </Section>

        <div className="grid md:grid-cols-2 gap-4">
          <Section title="Industries" confidence={conf.industry}>
            {editing ? (
              <TagEditor
                tags={(editData?.industries ?? d.industries ?? []) as string[]}
                onChange={(v) => updateField("industries", v)}
                color="bg-blue-500/10 text-blue-700"
                placeholder="Add industry..."
              />
            ) : (
              <TagList items={d.industries as string[] ?? []} color="bg-blue-500/10 text-blue-700" />
            )}
          </Section>

          <Section title="Company Size" confidence={conf.size}>
            {editing ? (
              <RangeEditor
                min={((editData?.employeeRange ?? empRange) as EmployeeRange).min}
                max={((editData?.employeeRange ?? empRange) as EmployeeRange).max}
                sweetSpot={((editData?.employeeRange ?? empRange) as EmployeeRange).sweetSpot}
                onChange={(v) => updateField("employeeRange", v)}
              />
            ) : (
            <div className="text-xs text-foreground">
              <span className="font-semibold">{empRange.min.toLocaleString()}</span>
              <span className="text-muted-foreground"> – </span>
              <span className="font-semibold">{empRange.max.toLocaleString()}</span>
              <span className="text-muted-foreground"> employees</span>
              {empRange.sweetSpot && (
                <span className="text-muted-foreground"> · Sweet spot: {empRange.sweetSpot.toLocaleString()}</span>
              )}
            </div>
            )}
          </Section>

          <Section title="Geographies" confidence={conf.geo}>
            {editing ? (
              <TagEditor
                tags={(editData?.geographies ?? d.geographies ?? []) as string[]}
                onChange={(v) => updateField("geographies", v)}
                color="bg-violet-500/10 text-violet-700"
                placeholder="Add country/region..."
              />
            ) : (
              <TagList items={d.geographies as string[] ?? []} color="bg-violet-500/10 text-violet-700" />
            )}
          </Section>

          <Section title="Keywords">
            {editing ? (
              <TagEditor
                tags={(editData?.keywords ?? d.keywords ?? []) as string[]}
                onChange={(v) => updateField("keywords", v)}
                color="bg-slate-500/10 text-slate-600"
                placeholder="Add keyword..."
              />
            ) : (
              <TagList items={d.keywords as string[] ?? []} color="bg-slate-500/10 text-slate-600" />
            )}
          </Section>
        </div>

        {/* Buying Signals */}
        <Section title="Buying Signals">
          <div className="space-y-1.5">
            {signals.map((signal, i) => (
              <div key={i} className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className={`text-[9px] py-0 h-4 ${
                    signal.strength === "strong"
                      ? "bg-emerald-500/10 text-emerald-700"
                      : signal.strength === "moderate"
                        ? "bg-amber-500/10 text-amber-700"
                        : "bg-slate-500/10 text-slate-600"
                  }`}
                >
                  {signal.strength ?? "moderate"}
                </Badge>
                <span className="text-xs text-foreground">{signal.name}</span>
              </div>
            ))}
            {signals.length === 0 && (
              <span className="text-xs text-muted-foreground italic">No buying signals defined</span>
            )}
          </div>
        </Section>

        <div className="grid md:grid-cols-2 gap-4">
          <Section title="Competitors">
            {editing ? (
              <TagEditor
                tags={(editData?.competitors ?? d.competitors ?? []) as string[]}
                onChange={(v) => updateField("competitors", v)}
                color="bg-rose-500/10 text-rose-700"
                placeholder="Add competitor..."
              />
            ) : (
              <TagList items={d.competitors as string[] ?? []} color="bg-rose-500/10 text-rose-700" />
            )}
          </Section>

          <Section title="Disqualifiers">
            {editing ? (
              <TagEditor
                tags={(editData?.disqualifiers ?? d.disqualifiers ?? []) as string[]}
                onChange={(v) => updateField("disqualifiers", v)}
                color="bg-red-500/10 text-red-600"
                placeholder="Add disqualifier..."
              />
            ) : (
              <TagList items={d.disqualifiers as string[] ?? []} color="bg-red-500/10 text-red-600" />
            )}
          </Section>
        </div>

        {/* ICP Evolution Proposals */}
        {proposals.length > 0 && (
          <div className="border rounded-lg p-4 bg-amber-50/50 dark:bg-amber-950/10 border-amber-500/20">
            <h3 className="text-sm font-semibold text-foreground mb-2">ICP Evolution Suggestions</h3>
            {proposals.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <div>
                  <p className="text-xs text-foreground">Based on {p.sampleSize} data points</p>
                  <p className="text-[10px] text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm" variant="outline" className="text-xs h-7"
                    onClick={() => respondMutation.mutate({ proposalId: p.id, action: "reject" })}
                  >
                    Dismiss
                  </Button>
                  <Button
                    size="sm" className="text-xs h-7"
                    onClick={() => respondMutation.mutate({ proposalId: p.id, action: "accept" })}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Apollo Preview */}
        {apolloQuery.data && (
          <div className="border rounded-lg p-4 bg-muted/30">
            <h3 className="text-sm font-semibold text-foreground mb-2">Apollo Search Preview</h3>
            <div className="grid md:grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-medium text-muted-foreground mb-1">Organization Filters</p>
                <pre className="text-[10px] bg-card p-2 rounded border overflow-auto max-h-32">
                  {JSON.stringify(apolloQuery.data.orgFilters, null, 2)}
                </pre>
              </div>
              <div>
                <p className="font-medium text-muted-foreground mb-1">People Filters</p>
                <pre className="text-[10px] bg-card p-2 rounded border overflow-auto max-h-32">
                  {JSON.stringify(apolloQuery.data.peopleFilters, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
