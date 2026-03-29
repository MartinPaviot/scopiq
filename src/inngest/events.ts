/**
 * Typed Inngest Event Schemas for Scopiq.
 */
export type Events = {
  "tam/build.requested": {
    data: {
      workspaceId: string;
      tamBuildId: string;
      siteUrl: string;
    };
  };
  "tam/build.expand": {
    data: {
      workspaceId: string;
      tamBuildId: string;
      pages: number;
    };
  };
  "tam/signals.enrich": {
    data: {
      workspaceId: string;
      tamBuildId: string;
    };
  };
  "icp/evolve": {
    data: {
      workspaceId: string;
      trigger: "cron" | "event";
    };
  };
};
