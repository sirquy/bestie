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
