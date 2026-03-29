"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Rocket, FileText, Database, LinkedinLogo } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { WebsiteSource } from "@/components/setup/website-source";
import { CsvSource } from "@/components/setup/csv-source";
import { LinkedInSource } from "@/components/setup/linkedin-source";
import { SourceCard } from "@/components/setup/source-card";
import { trpc } from "@/lib/trpc-client";
import { toast } from "sonner";

export default function SetupPage() {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);

  const sourcesQuery = trpc.ingestion.getSources.useQuery();
  const inferMutation = trpc.icp.infer.useMutation({
    onSuccess: () => {
      toast.success("ICP generated! Redirecting to review...");
      router.push("/icp");
    },
    onError: (err) => {
      toast.error(err.message ?? "Failed to generate ICP");
      setIsGenerating(false);
    },
  });

  const sources = sourcesQuery.data ?? [];
  const completedCount = sources.filter((s) => s.status === "complete").length;
  const hasWebsite = sources.some((s) => s.type === "website" && s.status === "complete");

  const handleGenerateIcp = () => {
    setIsGenerating(true);
    inferMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <h1 className="text-2xl font-heading font-bold text-foreground">
            Tell us about your business
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-lg">
            The more data you provide, the more precise your ICP and TAM will be.
            Start with your website — everything else is optional but improves accuracy.
          </p>

          {/* Progress */}
          <div className="flex items-center gap-3 mt-5">
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`h-1.5 w-8 rounded-full transition-colors ${
                    i < completedCount ? "bg-primary" : "bg-muted"
                  }`}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {completedCount} source{completedCount !== 1 ? "s" : ""} provided
            </span>
          </div>
        </div>
      </div>

      {/* Sources Grid */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="grid gap-4 md:grid-cols-2">
          {/* P0 Sources */}
          <div className="md:col-span-2">
            <WebsiteSource />
          </div>

          <CsvSource />

          <LinkedInSource
            type="linkedin_company"
            title="LinkedIn Company Page"
            description="Industry, size, and specialties from your company profile"
            placeholder="https://linkedin.com/company/your-company"
            urlPattern="linkedin.com/company/"
          />

          <LinkedInSource
            type="linkedin_profile"
            title="Your LinkedIn Profile"
            description="Your background helps us understand product-market intuition"
            placeholder="https://linkedin.com/in/your-name"
            urlPattern="linkedin.com/in/"
          />

          {/* P1 Sources (Coming Soon) */}
          <SourceCard
            title="LinkedIn Connections"
            description="Upload your connections CSV for network proximity signals"
            icon={<LinkedinLogo className="size-5" weight="fill" />}
            status="empty"
            comingSoon
          >
            <div />
          </SourceCard>

          <SourceCard
            title="Strategic Documents"
            description="Upload pitch decks, strategy docs, or market research (PDF, DOCX)"
            icon={<FileText className="size-5" />}
            status="empty"
            comingSoon
          >
            <div />
          </SourceCard>

          <SourceCard
            title="CRM Import"
            description="Connect HubSpot or upload a CRM export for deal history"
            icon={<Database className="size-5" />}
            status="empty"
            comingSoon
          >
            <div />
          </SourceCard>
        </div>

        {/* Generate ICP CTA */}
        <div className="mt-8 flex justify-center">
          <Button
            size="lg"
            className="gap-2 px-8"
            disabled={!hasWebsite || isGenerating}
            onClick={handleGenerateIcp}
          >
            <Rocket className="size-4" weight="fill" />
            {isGenerating ? "Generating ICP..." : "Generate ICP"}
          </Button>
        </div>
        {!hasWebsite && (
          <p className="text-center text-xs text-muted-foreground mt-2">
            Add your website URL to get started
          </p>
        )}
      </div>
    </div>
  );
}
