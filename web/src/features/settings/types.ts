export type MemoryWritePolicy = "ask" | "allow" | "deny";

export interface SettingsSummary {
  ok: true;
  agent: {
    name: string;
    ownerName: string;
    language: string;
    timeZone?: string;
    toneIntensity: number;
  };
  memory: {
    writePolicy: MemoryWritePolicy;
  };
  workspace: {
    defaultPath?: string;
    externalPathCount: number;
  };
  llm: {
    primary: string;
    fallbackCount: number;
    authProfile: string;
    profileCount: number;
    modelCount: number;
  };
}

export interface TunnelSummary {
  ok: true;
  tunnel?: {
    hostname: string;
    url: string;
    status: string;
    updatedAt: string;
    lastSeenAt: string | null;
    connectorRunning: boolean;
    failureCode?: string;
    failureMessage?: string;
  };
}
