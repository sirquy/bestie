import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpCircle,
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
  Users,
  WandSparkles,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { AgentsPanel, AgentsPanelError } from "@/features/agents/AgentsPanel";
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
import type { AgentsSummary } from "@/features/agents/types";
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
import { alertDialog, confirmDialog } from "@/lib/dialogs";
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
  | "agents"
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
  { id: "chat", title: "Trò chuyện", nav: "Trò chuyện", route: "/chat", description: "Trò chuyện với Bestie và tiếp tục các cuộc hội thoại trước đó.", icon: MessageSquareText, endpoint: "/api/chat/sessions" },
  { id: "doctor", title: "Kiểm tra", nav: "Kiểm tra", route: "/doctor", description: "Kiểm tra trạng thái thiết lập và sửa lỗi phổ biến an toàn.", icon: HeartPulse, endpoint: "/api/doctor" },
  { id: "providers", title: "Nhà cung cấp AI", nav: "Nhà cung cấp", route: "/providers", description: "Chọn dịch vụ AI và cấu hình phương án dự phòng.", icon: PlugZap, endpoint: "/api/providers" },
  { id: "character", title: "Tính cách", nav: "Tính cách", route: "/character", description: "Điều chỉnh tính cách và phong cách trò chuyện của Bestie.", icon: Bot, endpoint: "/api/character" },
  { id: "memory", title: "Bộ nhớ", nav: "Bộ nhớ", route: "/memory", description: "Xem thông tin đã ghi nhớ và các cập nhật đang chờ.", icon: Brain, endpoint: "/api/memory" },
  { id: "knowledge", title: "Bản đồ tri thức", nav: "Tri thức", route: "/knowledge", description: "Khám phá tri thức đã liên kết và dọn dẹp dữ liệu.", icon: GitBranch, endpoint: "/api/knowledge-graph" },
  { id: "channels", title: "Kênh kết nối", nav: "Kênh", route: "/channels", description: "Quản lý kênh đã kết nối và tin nhắn hẹn giờ.", icon: Cable, endpoint: "/api/channels" },
  { id: "agents", title: "Đội agent", nav: "Agent", route: "/agents", description: "Thuê agent cố định, giao việc và theo dõi hàng đợi xử lý.", icon: Users, endpoint: "/api/agents" },
  { id: "approvals", title: "Phê duyệt", nav: "Phê duyệt", route: "/approvals", description: "Các hành động cần bạn xem xét trước khi thực hiện.", icon: ClipboardCheck, endpoint: "/api/approvals" },
  { id: "mcp", title: "Tiện ích mở rộng", nav: "Tiện ích mở rộng", route: "/mcp", description: "Quản lý tiện ích mở rộng và quyền truy cập công cụ.", icon: TerminalSquare, endpoint: "/api/mcp" },
  { id: "tools", title: "Công cụ & quyền", nav: "Công cụ", route: "/tools", description: "Xem Bestie được phép truy cập và thực hiện những gì.", icon: ShieldCheck, endpoint: "/api/tools" },
  { id: "skills", title: "Kỹ năng", nav: "Kỹ năng", route: "/skills", description: "Quản lý các kỹ năng đã cài cho Bestie.", icon: WandSparkles, endpoint: "/api/skills" },
  { id: "settings", title: "Cài đặt", nav: "Cài đặt", route: "/settings", description: "Điều chỉnh tuỳ chọn an toàn cho Bestie.", icon: Settings, endpoint: "/api/settings" },
];

const defaultPanel = panels[0];
const panelsByRoute = new Map<string, PanelDefinition>(panels.map((panel) => [panel.route, panel]));
const panelsById = new Map(panels.map((panel) => [panel.id, panel]));
const legacyPanelIds = new Map(panels.map((panel) => [`${panel.id}-panel`, panel.id]));
const SIDEBAR_COLLAPSED_KEY = "bestie.ui.sidebarCollapsed";
const UPDATE_DISMISSED_VERSION_KEY = "bestie.ui.updateDismissedVersion";

interface UpdateSummary {
  ok: boolean;
  packageName: string;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  installCommand: string;
  error?: string;
}

interface UpdateApplyResult {
  ok: boolean;
  message: string;
  output?: string;
}

function panelFromLocation(location: Location): PanelDefinition {
  const legacyHash = location.hash.startsWith("#") ? legacyPanelIds.get(location.hash.slice(1)) : undefined;
  if (legacyHash) return panelsById.get(legacyHash) ?? defaultPanel;
  const route = normalizeRoute(location.pathname);
  if (route.startsWith("/agents/")) return panelsById.get("agents") ?? defaultPanel;
  if (route.startsWith("/skills/")) return panelsById.get("skills") ?? defaultPanel;
  return panelsByRoute.get(route) ?? defaultPanel;
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
  const [updateSummary, setUpdateSummary] = useState<UpdateSummary | null>(null);
  const [updateDismissedVersion, setUpdateDismissedVersion] = useState(() => readUpdateDismissedVersion());
  const [updateBusy, setUpdateBusy] = useState(false);
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
  const updateAvailable = Boolean(updateSummary?.ok && updateSummary.updateAvailable && updateSummary.latestVersion && updateSummary.latestVersion !== updateDismissedVersion);

  async function dismissUpdateBanner(): Promise<void> {
    if (!updateSummary?.latestVersion) return;
    writeUpdateDismissedVersion(updateSummary.latestVersion);
    setUpdateDismissedVersion(updateSummary.latestVersion);
  }

  async function applyLatestUpdate(): Promise<void> {
    if (!updateSummary?.latestVersion) return;
    if (!await confirmDialog({ title: "Cập nhật Bestie Agent", description: `Cài Bestie Agent ${updateSummary.latestVersion}? Lệnh sẽ chạy: ${updateSummary.installCommand}`, confirmLabel: "Cập nhật", cancelLabel: "Để sau" })) return;
    setUpdateBusy(true);
    try {
      const result = await fetchJson<UpdateApplyResult>("/api/update/apply", { method: "POST", body: JSON.stringify({ confirm: true }) });
      await alertDialog({ title: result.ok ? "Đã chạy cập nhật" : "Cập nhật ch?a th?nh c?ng", description: result.message, confirmLabel: "Đã hiểu", tone: result.ok ? "default" : "destructive" });
    } catch (error) {
      await alertDialog({ title: "Cập nhật ch?a th?nh c?ng", description: error instanceof Error ? error.message : "Không thể chạy cập nhật.", confirmLabel: "Đã hiểu", tone: "destructive" });
    } finally {
      setUpdateBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden p-3 md:p-5 lg:p-8">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,rgba(166,244,172,0.12),transparent_24rem),radial-gradient(circle_at_100%_20%,rgba(255,181,91,0.12),transparent_26rem)]" />
      <div className="pointer-events-none fixed inset-x-8 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      <div className="mx-auto max-w-[92rem]">
        {sidebarCollapsed ? (
          <Button
            aria-label="Mở rộng thanh bên"
            className="fixed left-3 top-3 z-50 border-white/10 bg-card/85 shadow-glow backdrop-blur-xl lg:hidden"
            data-sidebar-floating-toggle
            size="icon"
            title="Mở rộng thanh bên"
            type="button"
            variant="outline"
            onClick={() => setSidebarCollapsed(false)}
          >
            <ChevronsRight />
          </Button>
        ) : <button className="fixed inset-0 z-30 bg-black/35 backdrop-blur-[1px] lg:hidden" aria-label="Đóng thanh bên" type="button" onClick={() => setSidebarCollapsed(true)} />}

        <aside className={cn("no-scrollbar fixed bottom-3 left-3 top-3 z-40 mb-0 overflow-y-auto rounded-[1.25rem] border border-white/10 bg-card/85 shadow-glow ring-1 ring-white/5 backdrop-blur-xl transition-all duration-300 sm:rounded-[1.5rem] lg:bottom-8 lg:left-[max(2rem,calc((100vw-92rem)/2+2rem))] lg:top-8 lg:z-30", sidebarCollapsed ? "pointer-events-none w-[min(18rem,calc(100vw-1.5rem))] -translate-x-[calc(100%+1rem)] p-3 lg:pointer-events-auto lg:w-[4.75rem] lg:translate-x-0 lg:p-2.5" : "w-[min(18rem,calc(100vw-1.5rem))] translate-x-0 p-3 lg:w-[16rem]")} data-sidebar-state={sidebarCollapsed ? "collapsed" : "expanded"}>
          <div className={cn("flex items-center gap-2.5", sidebarCollapsed ? "mb-0 justify-between lg:mb-4 lg:flex-col lg:justify-center" : "mb-4 justify-between sm:mb-5")}>
            <div className={cn("flex min-w-0 items-center gap-2.5", sidebarCollapsed ? "lg:justify-center" : "")}>
              <div className="flex size-10 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-lg shadow-primary/20 ring-1 ring-white/20">
                <img src={bestieAppIcon} alt="Bestie Agent" className="size-full object-cover" />
              </div>
              <div className={cn("min-w-0 transition-opacity duration-200", sidebarCollapsed ? "hidden" : "block")}>
                <p className="text-lg font-bold tracking-tight">Bestie</p>
                <p className="text-xs text-muted-foreground">Không gian AI cá nhân</p>
              </div>
            </div>
            <Button
              aria-label={sidebarCollapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}
              className="inline-flex shrink-0 border-white/10 bg-background/50 hover:bg-secondary/80"
              data-sidebar-toggle
              size="icon"
              title={sidebarCollapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}
              type="button"
              variant="outline"
              onClick={() => setSidebarCollapsed((current) => !current)}
            >
              {sidebarCollapsed ? <ChevronsRight /> : <ChevronsLeft />}
            </Button>
          </div>
          <nav className={cn("grid-cols-1 gap-1", sidebarCollapsed ? "hidden lg:grid" : "grid")}>
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
        </aside>

        <main className={cn("grid min-w-0 gap-4 transition-[margin] duration-300", sidebarCollapsed ? "lg:ml-[5.75rem]" : "lg:ml-[17rem]")}>
          {updateAvailable && updateSummary ? <UpdateBanner summary={updateSummary} busy={updateBusy} onApply={() => void applyLatestUpdate()} onDismiss={() => void dismissUpdateBanner()} /> : null}
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
              ) : selectedPanel.id === "agents" ? (
                activeError ? <AgentsPanelError error={activeError} /> : (
                  <AgentsPanel
                    data={activeData as unknown as AgentsSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, agents: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, agents: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, agents: loading }))}
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

function UpdateBanner({ summary, busy, onApply, onDismiss }: { summary: UpdateSummary; busy: boolean; onApply: () => void; onDismiss: () => void }): ReactElement {
  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/15 p-3 text-sm shadow-glow ring-1 ring-accent/10" data-update-banner>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <ArrowUpCircle className="mt-0.5 size-5 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="font-semibold">Có bản Bestie Agent mới: {summary.latestVersion}</p>
            <p className="text-muted-foreground">Bạn đang dùng {summary.currentVersion}. Cập nhật để nhận tính năng và bản sửa mới nhất.</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" onClick={onApply} disabled={busy}><ArrowUpCircle /> {busy ? "Đang cập nhật..." : "Cập nhật ngay"}</Button>
          <Button size="sm" variant="outline" onClick={onDismiss} disabled={busy}>Để sau</Button>
          <Button size="icon" variant="ghost" aria-label="Ẩn thông báo cập nhật" onClick={onDismiss} disabled={busy}><X /></Button>
        </div>
      </div>
    </div>
  );
}

function readUpdateDismissedVersion(): string {
  try {
    return window.localStorage.getItem(UPDATE_DISMISSED_VERSION_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeUpdateDismissedVersion(version: string): void {
  try {
    window.localStorage.setItem(UPDATE_DISMISSED_VERSION_KEY, version);
  } catch {
  }
}

export default App;
