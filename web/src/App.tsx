import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Brain,
  Cable,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Gauge,
  GitBranch,
  HeartPulse,
  MessageSquareText,
  PlugZap,
  Settings,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  WandSparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApprovalsPanel, ApprovalsPanelError } from "@/features/approvals/ApprovalsPanel";
import { ChannelsPanel, ChannelsPanelError } from "@/features/channels/ChannelsPanel";
import { CharacterPanel, CharacterPanelError } from "@/features/character/CharacterPanel";
import { ChatPanel, ChatPanelError } from "@/features/chat/ChatPanel";
import { DoctorPanel, DoctorPanelError } from "@/features/doctor/DoctorPanel";
import { KnowledgePanel, KnowledgePanelError } from "@/features/knowledge/KnowledgePanel";
import { MemoryPanel, MemoryPanelError } from "@/features/memory/MemoryPanel";
import { McpPanel, McpPanelError } from "@/features/mcp/McpPanel";
import { ProviderPanel, ProviderPanelError } from "@/features/providers/ProviderPanel";
import { SettingsPanel, SettingsPanelError } from "@/features/settings/SettingsPanel";
import { SkillsPanel, SkillsPanelError } from "@/features/skills/SkillsPanel";
import { ToolsPanel, ToolsPanelError } from "@/features/tools/ToolsPanel";
import type { ApprovalsSummary } from "@/features/approvals/types";
import type { ChannelSummary } from "@/features/channels/types";
import type { CharacterSummary } from "@/features/character/types";
import type { ChatSessionsSummary } from "@/features/chat/types";
import type { DoctorSummary } from "@/features/doctor/types";
import type { KnowledgeGraphSummary } from "@/features/knowledge/types";
import type { MemorySummary } from "@/features/memory/types";
import type { McpSummary } from "@/features/mcp/types";
import type { ProviderSummary } from "@/features/providers/types";
import type { SettingsSummary } from "@/features/settings/types";
import type { SkillsSummary } from "@/features/skills/types";
import type { ToolsSummary } from "@/features/tools/types";
import { fetchJson, formatError, readRecord, readText, type JsonRecord } from "@/lib/api";

type PanelId =
  | "chat"
  | "doctor"
  | "providers"
  | "character"
  | "memory"
  | "knowledge"
  | "channels"
  | "approvals"
  | "mcp"
  | "tools"
  | "skills"
  | "settings";

interface PanelDefinition {
  id: PanelId;
  title: string;
  nav: string;
  description: string;
  icon: typeof MessageSquareText;
  endpoint?: string;
}

const panels: PanelDefinition[] = [
  { id: "chat", title: "Local Chat", nav: "Chat", description: "Local chat sessions for testing memory, tools, and response flow.", icon: MessageSquareText, endpoint: "/api/chat/sessions" },
  { id: "doctor", title: "Doctor", nav: "Doctor", description: "Runtime, secrets, memory, channel health, and safe fixes.", icon: HeartPulse, endpoint: "/api/doctor" },
  { id: "providers", title: "Provider Hub", nav: "Providers", description: "Primary model, fallbacks, presets, and provider diagnostics.", icon: PlugZap, endpoint: "/api/providers" },
  { id: "character", title: "Character Studio", nav: "Character", description: "Character file, system prompt, and tone guardrails.", icon: Bot, endpoint: "/api/character" },
  { id: "memory", title: "Memory Center", nav: "Memory", description: "Memory search, pending approvals, and hygiene state.", icon: Brain, endpoint: "/api/memory" },
  { id: "knowledge", title: "Knowledge Graph", nav: "Knowledge", description: "Entity/relation map, trust review, and graph actions.", icon: GitBranch, endpoint: "/api/knowledge-graph" },
  { id: "channels", title: "Channel Hub", nav: "Channels", description: "Telegram, Zalo, cron, and daemon channel controls.", icon: Cable, endpoint: "/api/channels" },
  { id: "approvals", title: "Approvals", nav: "Approvals", description: "Permission-gated pending actions waiting for owner review.", icon: ClipboardCheck, endpoint: "/api/approvals" },
  { id: "mcp", title: "MCP Hub", nav: "MCP", description: "Server, tool, OAuth, and classified read status.", icon: TerminalSquare, endpoint: "/api/mcp" },
  { id: "tools", title: "Tools & Permissions", nav: "Tools", description: "Tool policy and allowed external workspace paths.", icon: ShieldCheck, endpoint: "/api/tools" },
  { id: "skills", title: "Skills", nav: "Skills", description: "Installed skills, library metadata, and trust/risk review.", icon: WandSparkles, endpoint: "/api/skills" },
  { id: "settings", title: "Settings", nav: "Settings", description: "Low-risk agent and memory policy edits.", icon: Settings, endpoint: "/api/settings" },
];

function App(): ReactElement {
  const [activePanel, setActivePanel] = useState<PanelId>("chat");
  const [status, setStatus] = useState<JsonRecord | null>(null);
  const [panelData, setPanelData] = useState<Record<string, JsonRecord>>({});
  const [panelErrors, setPanelErrors] = useState<Record<string, unknown>>({});
  const [loadingPanels, setLoadingPanels] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const selectedPanel = useMemo(() => panels.find((panel) => panel.id === activePanel) ?? panels[0], [activePanel]);

  function refreshStatus(): void {
    void fetchJson("/api/status").then(setStatus).catch((fetchError: unknown) => setError(formatError(fetchError)));
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    if (!selectedPanel.endpoint || panelData[selectedPanel.id] || loadingPanels[selectedPanel.id]) return;
    setLoadingPanels((current) => ({ ...current, [selectedPanel.id]: true }));
    void fetchJson(selectedPanel.endpoint)
      .then((data) => {
        setPanelData((current) => ({ ...current, [selectedPanel.id]: data }));
        setPanelErrors((current) => ({ ...current, [selectedPanel.id]: undefined }));
      })
      .catch((fetchError: unknown) => setPanelErrors((current) => ({ ...current, [selectedPanel.id]: fetchError })))
      .finally(() => setLoadingPanels((current) => ({ ...current, [selectedPanel.id]: false })));
  }, [loadingPanels, panelData, selectedPanel]);

  const activeData = panelData[selectedPanel.id];
  const activeError = panelErrors[selectedPanel.id];
  const ActiveIcon = selectedPanel.icon;

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[18rem_1fr]">
        <aside className="rounded-3xl border border-white/10 bg-card/80 p-4 shadow-glow backdrop-blur">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
              <Sparkles className="size-6" />
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight">Bestie</p>
              <p className="text-xs text-muted-foreground">React cockpit migration</p>
            </div>
          </div>
          <nav className="grid gap-1">
            {panels.map((panel) => {
              const Icon = panel.icon;
              return (
                <Button
                  key={panel.id}
                  className="justify-start"
                  variant={activePanel === panel.id ? "secondary" : "ghost"}
                  onClick={() => setActivePanel(panel.id)}
                >
                  <Icon />
                  {panel.nav}
                </Button>
              );
            })}
          </nav>
        </aside>

        <main className="grid gap-4">
          <section className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
            <Card className="border-white/10 bg-card/80 backdrop-blur">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Badge className="mb-3" variant="secondary">Localhost UI</Badge>
                    <CardTitle className="text-3xl md:text-4xl">Companion control center</CardTitle>
                    <CardDescription className="mt-3 max-w-2xl text-base">
                      First shell is running on React + Vite + TypeScript + Tailwind, using shadcn-style components before custom UI.
                    </CardDescription>
                  </div>
                  <Button onClick={() => window.location.reload()}>
                    <Activity />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {error ? <StatusNotice tone="bad" text={error} /> : <RuntimeSummary status={status} />}
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-card/80 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Gauge className="size-5" /> Migration status</CardTitle>
                <CardDescription>Incremental bridge: React frontend, existing `/api/*` backend.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <ChecklistItem done label="Vite build pipeline" />
                <ChecklistItem done label="Tailwind design tokens" />
                <ChecklistItem done label="shadcn-style Button/Card/Badge" />
                <ChecklistItem done label="Existing runtime APIs reused" />
                <ChecklistItem label="Panel-by-panel feature parity" />
              </CardContent>
            </Card>
          </section>

          <Card className="border-white/10 bg-card/80 backdrop-blur">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2"><ActiveIcon className="size-5" /> {selectedPanel.title}</CardTitle>
                  <CardDescription>{selectedPanel.description}</CardDescription>
                </div>
                <Badge variant={loadingPanels[selectedPanel.id] ? "secondary" : "outline"}>
                  {loadingPanels[selectedPanel.id] ? "Loading" : selectedPanel.endpoint ?? "Local"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {selectedPanel.id === "chat" ? (
                activeError ? <ChatPanelError error={activeError} /> : (
                  <ChatPanel
                    data={activeData as unknown as ChatSessionsSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, chat: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, chat: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, chat: loading }))}
                  />
                )
              ) : selectedPanel.id === "doctor" ? (
                activeError ? <DoctorPanelError error={activeError} /> : (
                  <DoctorPanel
                    data={activeData as unknown as DoctorSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, doctor: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, doctor: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, doctor: loading }))}
                  />
                )
              ) : selectedPanel.id === "providers" ? (
                activeError ? <ProviderPanelError error={activeError} /> : (
                  <ProviderPanel
                    data={activeData as unknown as ProviderSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, providers: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, providers: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, providers: loading }))}
                  />
                )
              ) : selectedPanel.id === "character" ? (
                activeError ? <CharacterPanelError error={activeError} /> : (
                  <CharacterPanel
                    data={activeData as unknown as CharacterSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, character: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, character: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, character: loading }))}
                  />
                )
              ) : selectedPanel.id === "channels" ? (
                activeError ? <ChannelsPanelError error={activeError} /> : (
                  <ChannelsPanel
                    data={activeData as unknown as ChannelSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, channels: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, channels: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, channels: loading }))}
                  />
                )
              ) : selectedPanel.id === "approvals" ? (
                activeError ? <ApprovalsPanelError error={activeError} /> : (
                  <ApprovalsPanel
                    data={activeData as unknown as ApprovalsSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, approvals: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, approvals: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, approvals: loading }))}
                  />
                )
              ) : selectedPanel.id === "memory" ? (
                activeError ? <MemoryPanelError error={activeError} /> : (
                  <MemoryPanel
                    data={activeData as unknown as MemorySummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, memory: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, memory: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, memory: loading }))}
                  />
                )
              ) : selectedPanel.id === "knowledge" ? (
                activeError ? <KnowledgePanelError error={activeError} /> : (
                  <KnowledgePanel
                    data={activeData as unknown as KnowledgeGraphSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, knowledge: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, knowledge: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, knowledge: loading }))}
                  />
                )
              ) : selectedPanel.id === "mcp" ? (
                activeError ? <McpPanelError error={activeError} /> : (
                  <McpPanel
                    data={activeData as unknown as McpSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, mcp: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, mcp: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, mcp: loading }))}
                  />
                )
              ) : selectedPanel.id === "tools" ? (
                activeError ? <ToolsPanelError error={activeError} /> : (
                  <ToolsPanel
                    data={activeData as unknown as ToolsSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, tools: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, tools: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, tools: loading }))}
                  />
                )
              ) : selectedPanel.id === "skills" ? (
                activeError ? <SkillsPanelError error={activeError} /> : (
                  <SkillsPanel
                    data={activeData as unknown as SkillsSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, skills: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, skills: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, skills: loading }))}
                  />
                )
              ) : selectedPanel.id === "settings" ? (
                activeError ? <SettingsPanelError error={activeError} /> : (
                  <SettingsPanel
                    data={activeData as unknown as SettingsSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, settings: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, settings: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, settings: loading }))}
                    onStatusRefresh={refreshStatus}
                  />
                )
              ) : null}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}

function RuntimeSummary({ status }: { status: JsonRecord | null }): ReactElement {
  if (!status) return <StatusNotice tone="warn" text="Loading runtime summary..." />;

  const agent = readRecord(status.agent);
  const llm = readRecord(status.llm);
  const memory = readRecord(status.memory);
  const channels = readRecord(status.channels);
  const missingEnv = Array.isArray(status.missingEnvVars) ? status.missingEnvVars : [];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Metric label="Agent" value={readText(agent.name) || "Bestie"} tone="good" />
      <Metric label="Model" value={readText(llm.primary) || readText(llm.model) || "-"} />
      <Metric label="Memory" value={readText(memory.status) || readText(memory.count) || "local"} />
      <Metric label="Missing env" value={String(missingEnv.length)} tone={missingEnv.length ? "warn" : "good"} />
      <Metric label="Telegram" value={readText(readRecord(channels.telegram).status) || readText(readRecord(channels.telegram).enabled) || "-"} />
      <Metric label="Zalo" value={readText(readRecord(channels.zalo).status) || readText(readRecord(channels.zalo).enabled) || "-"} />
      <Metric label="Doctor" value={readText(status.doctorStatus) || readText(status.health) || "ready"} tone="good" />
      <Metric label="API" value={readText(status.ok) || "connected"} tone="good" />
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }): ReactElement {
  return (
    <div className="rounded-2xl border border-white/10 bg-background/40 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={tone === "good" ? "mt-2 font-semibold text-primary" : tone === "bad" ? "mt-2 font-semibold text-destructive" : tone === "warn" ? "mt-2 font-semibold text-accent" : "mt-2 font-semibold"}>{value || "-"}</p>
    </div>
  );
}

function ChecklistItem({ done = false, label }: { done?: boolean; label: string }): ReactElement {
  return (
    <div className="flex items-center gap-2">
      {done ? <CheckCircle2 className="size-4 text-primary" /> : <CircleAlert className="size-4 text-accent" />}
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

function StatusNotice({ text, tone }: { text: string; tone: "good" | "warn" | "bad" }): ReactElement {
  return <div className={tone === "bad" ? "rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive-foreground" : tone === "good" ? "rounded-2xl border border-primary/40 bg-primary/10 p-4 text-sm" : "rounded-2xl border border-accent/40 bg-accent/10 p-4 text-sm"}>{text}</div>;
}

export default App;













