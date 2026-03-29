"use client";

import { useState } from "react";
import { Gear } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc-client";
import { toast } from "sonner";

export default function SettingsPage() {
  const workspaceQuery = trpc.workspace.getSettings.useQuery();
  const updateMutation = trpc.workspace.updateSettings.useMutation({
    onSuccess: () => toast.success("Settings saved"),
    onError: (err) => toast.error(err.message),
  });

  const [name, setName] = useState("");

  const workspace = workspaceQuery.data;
  if (workspace && !name) setName(workspace.name);

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="text-xl font-heading font-bold flex items-center gap-2">
        <Gear className="size-5" />
        Settings
      </h1>

      <div className="mt-6 space-y-4">
        <div>
          <label className="text-sm font-medium">Workspace Name</label>
          <Input
            className="mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm font-medium">Company URL</label>
          <Input className="mt-1" value={workspace?.companyUrl ?? ""} disabled />
          <p className="text-xs text-muted-foreground mt-1">Change via Setup page</p>
        </div>

        <Button
          onClick={() => updateMutation.mutate({ name })}
          disabled={updateMutation.isPending}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
