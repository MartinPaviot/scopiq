"use client";

import { useState } from "react";
import { Key, CheckCircle, XCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc-client";
import { toast } from "sonner";

const INTEGRATIONS = [
  { type: "apollo", label: "Apollo", description: "Organization & people search for TAM building" },
  { type: "hubspot", label: "HubSpot", description: "Sync TAM accounts and contacts to your CRM" },
];

function IntegrationCard({ type, label, description }: { type: string; label: string; description: string }) {
  const [apiKey, setApiKey] = useState("");
  const integrationsQuery = trpc.integration.list.useQuery();
  const connectMutation = trpc.integration.connect.useMutation({
    onSuccess: () => {
      toast.success(`${label} connected`);
      integrationsQuery.refetch();
      setApiKey("");
    },
    onError: (err) => toast.error(err.message),
  });
  const disconnectMutation = trpc.integration.disconnect.useMutation({
    onSuccess: () => {
      toast.success(`${label} disconnected`);
      integrationsQuery.refetch();
    },
  });

  const existing = integrationsQuery.data?.find((i) => i.type === type);
  const isConnected = existing?.status === "ACTIVE";

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Key className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{label}</h3>
          {isConnected && <CheckCircle className="size-4 text-emerald-500" weight="fill" />}
        </div>
        {isConnected && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-red-500 hover:text-red-600"
            onClick={() => disconnectMutation.mutate({ type })}
          >
            Disconnect
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-3">{description}</p>
      {!isConnected && (
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="text-xs"
          />
          <Button
            size="sm"
            onClick={() => connectMutation.mutate({ type, apiKey })}
            disabled={!apiKey || connectMutation.isPending}
          >
            Connect
          </Button>
        </div>
      )}
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="text-xl font-heading font-bold">Integrations</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-6">
        Connect your tools to power TAM building and CRM sync.
      </p>
      <div className="space-y-4">
        {INTEGRATIONS.map((i) => (
          <IntegrationCard key={i.type} {...i} />
        ))}
      </div>
    </div>
  );
}
