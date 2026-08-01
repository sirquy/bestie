import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Brain,
  Cable,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  GitBranch,
  HeartPulse,
  MessageSquareText,
  PlugZap,
  Settings,
  ShieldCheck,
  TerminalSquare,
  WandSparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { fetchJson, type JsonRecord } from "@/lib/api";
import { cn } from "@/lib/utils";
import bestieAppIcon from "@/assets/bestie-app-icon.png";

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
  route: `/${string}`;
  description: string;
  icon: typeof MessageSquareText;
  endpoint?: string;
}

const panels: PanelDefinition[] = [
  { id: "chat", title: "Local Chat", nav: "Chat", route: "/chat", description: "Chat with Bestie and continue past conversations.", icon: MessageSquareText, endpoint: "/api/chat/sessions" },
  { id: "doctor", title: "Doctor", nav: "Doctor", route: "/doctor", description: "Check setup health and fix common issues safely.", icon: HeartPulse, endpoint: "/api/doctor" },
  { id: "providers", title: "Provider Hub", nav: "Providers", route: "/providers", description: "Choose AI services and manage fallback options.", icon: PlugZap, endpoint: "/api/providers" },
  { id: "character", title: "Character Studio", nav: "Character", route: "/character", description: "Tune Bestie's personality and conversation style.", icon: Bot, endpoint: "/api/character" },
  { id: "memory", title: "Memory Center", nav: "Memory", route: "/memory", description: "Review remembered facts and pending updates.", icon: Brain, endpoint: "/api/memory" },
  { id: "knowledge", title: "Knowledge Graph", nav: "Knowledge", route: "/knowledge", description: "Explore connected knowledge and clean it up.", icon: GitBranch, endpoint: "/api/knowledge-graph" },
  { id: "channels", title: "Channel Hub", nav: "Channels", route: "/channels", description: "Manage connected channels and scheduled messages.", icon: Cable, endpoint: "/api/channels" },
  { id: "approvals", title: "Approvals", nav: "Approvals", route: "/approvals", description: "Permission-gated pending actions waiting for owner review.", icon: ClipboardCheck, endpoint: "/api/approvals" },
  { id: "mcp", title: "Extensions", nav: "Extensions", route: "/mcp", description: "Manage connected extensions and tool access.", icon: TerminalSquare, endpoint: "/api/mcp" },
  { id: "tools", title: "Tools & Permissions", nav: "Tools", route: "/tools", description: "Review what Bestie can access and do.", icon: ShieldCheck, endpoint: "/api/tools" },
  { id: "skills", title: "Skills", nav: "Skills", route: "/skills", description: "Manage Bestie's installed abilities.", icon: WandSparkles, endpoint: "/api/skills" },
  { id: "settings", title: "Settings", nav: "Settings", route: "/settings", description: "Adjust safe preferences for Bestie.", icon: Settings, endpoint: "/api/settings" },
];

const defaultPanel = panels[0];
const panelsByRoute = new Map<string, PanelDefinition>(panels.map((panel) => [panel.route, panel]));
const panelsById = new Map(panels.map((panel) => [panel.id, panel]));
const legacyPanelIds = new Map(panels.map((panel) => [`${panel.id}-panel`, panel.id]));
const SIDEBAR_COLLAPSED_KEY = "bestie.ui.sidebarCollapsed";

function panelFromLocation(location: Location): PanelDefinition {
  const legacyHash = location.hash.startsWith("#") ? legacyPanelIds.get(location.hash.slice(1)) : undefined;
  if (legacyHash) return panelsById.get(legacyHash) ?? defaultPanel;
  return panelsByRoute.get(normalizeRoute(location.pathname)) ?? defaultPanel;
}

function normalizeRoute(pathname: string): string {
  if (pathname === "/") return defaultPanel.route;
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function App(): ReactElement {
  const [activePanel, setActivePanel] = useState<PanelId>(() => panelFromLocation(window.location).id);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(readSidebarCollapsed);
  const [panelData, setPanelData] = useState<Record<string, JsonRecord>>({});
  const [panelErrors, setPanelErrors] = useState<Record<string, unknown>>({});
  const [loadingPanels, setLoadingPanels] = useState<Record<string, boolean>>({});

  const selectedPanel = useMemo(() => panels.find((panel) => panel.id === activePanel) ?? panels[0], [activePanel]);

  function navigateToPanel(panel: PanelDefinition, mode: "push" | "replace" = "push"): void {
    if (activePanel !== panel.id) setActivePanel(panel.id);
    const nextUrl = `${panel.route}${window.location.search}`;
    if (normalizeRoute(window.location.pathname) === panel.route && !window.location.hash) return;
    window.history[mode === "replace" ? "replaceState" : "pushState"]({ panelId: panel.id }, "", nextUrl);
  }

  function refreshStatus(): void {
    void fetchJson("/api/status").catch(() => undefined);
  }

  useEffect(() => {
    const panel = panelFromLocation(window.location);
    setActivePanel(panel.id);
    if (window.location.hash || window.location.pathname === "/") {
      window.history.replaceState({ panelId: panel.id }, "", `${panel.route}${window.location.search}`);
    }

    function handlePopState(): void {
      setActivePanel(panelFromLocation(window.location).id);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    document.title = `${selectedPanel.title} · Bestie`;
  }, [selectedPanel]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
    } catch {
    }
  }, [sidebarCollapsed]);

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
  return (
    <div className="relative min-h-screen overflow-x-hidden p-3 md:p-5 lg:p-8">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,rgba(166,244,172,0.12),transparent_24rem),radial-gradient(circle_at_100%_20%,rgba(255,181,91,0.12),transparent_26rem)]" />
      <div className="pointer-events-none fixed inset-x-8 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      <div className="mx-auto max-w-[92rem]">
        <aside className={cn("no-scrollbar mb-4 rounded-[1.25rem] border border-white/10 bg-card/70 shadow-glow ring-1 ring-white/5 backdrop-blur-xl transition-all duration-300 sm:rounded-[1.5rem] lg:fixed lg:bottom-8 lg:left-[max(2rem,calc((100vw-92rem)/2+2rem))] lg:top-8 lg:z-30 lg:mb-0 lg:overflow-y-auto", sidebarCollapsed ? "p-3 lg:w-[4.75rem] lg:p-2.5" : "p-3 lg:w-[16rem]")} data-sidebar-state={sidebarCollapsed ? "collapsed" : "expanded"}>
          <div className={cn("mb-4 flex items-center gap-2.5 sm:mb-5", sidebarCollapsed ? "justify-between lg:flex-col lg:justify-center" : "justify-between")}>
            <div className={cn("flex min-w-0 items-center gap-2.5", sidebarCollapsed ? "lg:justify-center" : "")}>
              <div className="flex size-10 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-lg shadow-primary/20 ring-1 ring-white/20">
                <img src={bestieAppIcon} alt="Bestie Agent" className="size-full object-cover" />
              </div>
              <div className={cn("min-w-0 transition-opacity duration-200", sidebarCollapsed ? "lg:hidden" : "block")}>
                <p className="text-lg font-bold tracking-tight">Bestie</p>
                <p className="text-xs text-muted-foreground">Personal AI workspace</p>
              </div>
            </div>
            <Button
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden shrink-0 border-white/10 bg-background/50 hover:bg-secondary/80 lg:inline-flex"
              data-sidebar-toggle
              size="icon"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              type="button"
              variant="outline"
              onClick={() => setSidebarCollapsed((current) => !current)}
            >
              {sidebarCollapsed ? <ChevronsRight /> : <ChevronsLeft />}
            </Button>
          </div>
            <nav className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-1">
            {panels.map((panel) => {
              const Icon = panel.icon;
              return (
                <Button
                  asChild
                  key={panel.id}
                  className={cn("h-9 justify-start rounded-xl text-sm text-muted-foreground transition-all hover:bg-secondary/70 hover:text-foreground", activePanel === panel.id ? "bg-secondary/90 text-foreground shadow-sm ring-1 ring-primary/20" : "", sidebarCollapsed ? "lg:justify-center lg:px-0" : "")}
                  variant={activePanel === panel.id ? "secondary" : "ghost"}
                >
                  <a
                    href={panel.route}
                    aria-current={activePanel === panel.id ? "page" : undefined}
                    aria-label={panel.nav}
                    title={sidebarCollapsed ? panel.nav : undefined}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                      event.preventDefault();
                      navigateToPanel(panel);
                    }}
                  >
                    <Icon />
                    <span className={cn("truncate", sidebarCollapsed ? "lg:sr-only" : "")}>{panel.nav}</span>
                  </a>
                </Button>
              );
            })}
          </nav>
          <Button
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="mt-3 w-full rounded-2xl border-white/10 bg-background/50 lg:hidden"
            data-sidebar-toggle-mobile
            type="button"
            variant="outline"
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            {sidebarCollapsed ? <ChevronsRight /> : <ChevronsLeft />}
            {sidebarCollapsed ? "Expand" : "Collapse"}
          </Button>
        </aside>

        <main className={cn("grid min-w-0 gap-4 transition-[margin] duration-300", sidebarCollapsed ? "lg:ml-[5.75rem]" : "lg:ml-[17rem]")}>
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
        </main>
      </div>
    </div>
  );
}

export default App;
