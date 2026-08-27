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
  LockKeyhole,
  MessageSquareText,
  PlugZap,
  Route,
  ScrollText,
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
import { ChannelEditor } from "@/features/channels/ChannelEditor";
import { CharacterPanel, CharacterPanelError } from "@/features/character/CharacterPanel";
import { ChatPanel, ChatPanelError } from "@/features/chat/ChatPanel";
import { DoctorPanel, DoctorPanelError } from "@/features/doctor/DoctorPanel";
import { KnowledgePanel, KnowledgePanelError } from "@/features/knowledge/KnowledgePanel";
import { LogsPanel, LogsPanelError } from "@/features/logs/LogsPanel";
import { MemoryPanel, MemoryPanelError } from "@/features/memory/MemoryPanel";
import { McpPanel, McpPanelError } from "@/features/mcp/McpPanel";
import { OnboardingScreen } from "@/features/onboarding/OnboardingScreen";
import { ProviderPanel, ProviderPanelError } from "@/features/providers/ProviderPanel";
import { SettingsPanel, SettingsPanelError } from "@/features/settings/SettingsPanel";
import { SkillsPanel, SkillsPanelError } from "@/features/skills/SkillsPanel";
import { ToolsPanel, ToolsPanelError } from "@/features/tools/ToolsPanel";
import type { AgentsSummary } from "@/features/agents/types";
import type { ApprovalsSummary } from "@/features/approvals/types";
import type { ChannelId, ChannelSummary } from "@/features/channels/types";
import type { CharacterSummary } from "@/features/character/types";
import type { ChatSessionsSummary } from "@/features/chat/types";
import type { DoctorSummary } from "@/features/doctor/types";
import type { KnowledgeGraphSummary } from "@/features/knowledge/types";
import type { LogsSummary } from "@/features/logs/types";
import type { MemorySummary } from "@/features/memory/types";
import type { McpSummary } from "@/features/mcp/types";
import type { ProviderSummary } from "@/features/providers/types";
import type { SettingsSummary } from "@/features/settings/types";
import type { SkillsSummary } from "@/features/skills/types";
import type { ToolsSummary } from "@/features/tools/types";
import { fetchJson, setCsrfToken, type JsonRecord } from "@/lib/api";
import { alertDialog, confirmDialog } from "@/lib/dialogs";
import { cn } from "@/lib/utils";
import bestieAppIcon from "@/assets/bestie-app-icon.png";

type PanelId =
  | "chat"
  | "doctor"
  | "models"
  | "modelProviders"
  | "character"
  | "memory"
  | "knowledge"
  | "logs"
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
  { id: "models", title: "Quản lý model", nav: "Models", route: "/models", description: "Chọn model chính, kiểm tra model và quản lý fallback.", icon: Route, endpoint: "/api/providers" },
  { id: "modelProviders", title: "Quản lý provider", nav: "Providers", route: "/models/providers", description: "Thêm, cấu hình và kiểm tra các provider AI.", icon: PlugZap, endpoint: "/api/providers" },
  { id: "character", title: "Tính cách", nav: "Tính cách", route: "/character", description: "Điều chỉnh tính cách và phong cách trò chuyện của Bestie.", icon: Bot, endpoint: "/api/character" },
  { id: "memory", title: "Bộ nhớ", nav: "Bộ nhớ", route: "/memory", description: "Xem thông tin đã ghi nhớ và các cập nhật đang chờ.", icon: Brain, endpoint: "/api/memory" },
  { id: "knowledge", title: "Bản đồ tri thức", nav: "Tri thức", route: "/knowledge", description: "Khám phá tri thức đã liên kết và dọn dẹp dữ liệu.", icon: GitBranch, endpoint: "/api/knowledge-graph" },
  { id: "logs", title: "Logs runtime", nav: "Logs", route: "/logs", description: "Kiểm tra log runtime gần nhất để chẩn đoán lỗi.", icon: ScrollText, endpoint: "/api/logs?lines=200" },
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
const legacyPanelIds = new Map<string, PanelId>([
  ...panels.map((panel) => [`${panel.id}-panel`, panel.id] as const),
  ["providers-panel", "modelProviders"],
]);
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

interface RuntimeStatus {
  ok: boolean;
  config: { exists: boolean };
}

function panelFromLocation(location: Location): PanelDefinition {
  const legacyHash = location.hash.startsWith("#") ? legacyPanelIds.get(location.hash.slice(1)) : undefined;
  if (legacyHash) return panelsById.get(legacyHash) ?? defaultPanel;
  const route = normalizeRoute(location.pathname);
  if (route === "/providers") return panelsById.get("modelProviders") ?? defaultPanel;
  if (route.startsWith("/settings/")) return panelsById.get("settings") ?? defaultPanel;
  if (route.startsWith("/agents/")) return panelsById.get("agents") ?? defaultPanel;
  if (route.startsWith("/channels/")) return panelsById.get("channels") ?? defaultPanel;
  if (route.startsWith("/skills/")) return panelsById.get("skills") ?? defaultPanel;
  return panelsByRoute.get(route) ?? defaultPanel;
}

function normalizeRoute(pathname: string): string {
  if (pathname === "/") return defaultPanel.route;
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function isChannelEditorRoute(route: string): boolean {
  return route === "/channels/telegram" || route === "/channels/zalo" || route === "/channels/zalo-personal";
}

function isCanonicalPanelRoute(route: string, panel: PanelDefinition): boolean {
  return route === panel.route
    || (panel.id === "settings" && route.startsWith("/settings/"))
    || (panel.id === "skills" && route.startsWith("/skills/"))
    || (panel.id === "agents" && route.startsWith("/agents/"))
    || (panel.id === "channels" && route.startsWith("/channels/"));
}

function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function App({ onLocked }: { onLocked: () => void }): ReactElement {
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>();
  const [activePanel, setActivePanel] = useState<PanelId>(() => panelFromLocation(window.location).id);
  const [activeRoute, setActiveRoute] = useState(() => normalizeRoute(window.location.pathname));
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(readSidebarCollapsed);
  const [updateSummary, setUpdateSummary] = useState<UpdateSummary | null>(null);
  const [updateDismissedVersion, setUpdateDismissedVersion] = useState(() => readUpdateDismissedVersion());
  const [updateBusy, setUpdateBusy] = useState(false);
  const [panelData, setPanelData] = useState<Record<string, JsonRecord>>({});
  const [panelErrors, setPanelErrors] = useState<Record<string, unknown>>({});
  const [loadingPanels, setLoadingPanels] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void fetchJson<RuntimeStatus>("/api/status")
      .then(setRuntimeStatus)
      .catch(() => setRuntimeStatus({ ok: false, config: { exists: false } }));
  }, []);

  useEffect(() => {
    if (!runtimeStatus?.ok || !runtimeStatus.config.exists) return;
    void fetchJson<UpdateSummary>("/api/update").then(setUpdateSummary).catch(() => undefined);
  }, [runtimeStatus]);

  const selectedPanel = useMemo(() => panels.find((panel) => panel.id === activePanel) ?? panels[0], [activePanel]);

  function navigateToPanel(panel: PanelDefinition, mode: "push" | "replace" = "push"): void {
    if (activePanel !== panel.id) setActivePanel(panel.id);
    setActiveRoute(panel.route);
    const nextUrl = `${panel.route}${window.location.search}`;
    if (normalizeRoute(window.location.pathname) === panel.route && !window.location.hash) return;
    window.history[mode === "replace" ? "replaceState" : "pushState"]({ panelId: panel.id }, "", nextUrl);
  }

  function navigateToRoute(route: string, mode: "push" | "replace" = "push"): void {
    const panel = panelFromLocation({ ...window.location, pathname: route, hash: "" } as Location);
    setActivePanel(panel.id);
    setActiveRoute(route);
    if (normalizeRoute(window.location.pathname) === route && !window.location.hash) return;
    window.history[mode === "replace" ? "replaceState" : "pushState"]({ panelId: panel.id }, "", `${route}${window.location.search}`);
  }

  function refreshStatus(): void {
    void fetchJson("/api/status").catch(() => undefined);
  }

  useEffect(() => {
    const panel = panelFromLocation(window.location);
    const route = normalizeRoute(window.location.pathname);
    setActivePanel(panel.id);
    setActiveRoute(route);
    if (window.location.hash || window.location.pathname === "/" || !isCanonicalPanelRoute(route, panel)) {
      window.history.replaceState({ panelId: panel.id }, "", `${panel.route}${window.location.search}`);
      setActiveRoute(panel.route);
    }

    function handlePopState(): void {
      setActivePanel(panelFromLocation(window.location).id);
      setActiveRoute(normalizeRoute(window.location.pathname));
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
    if (!runtimeStatus?.ok || !runtimeStatus.config.exists) return;
    if (!selectedPanel.endpoint || panelData[selectedPanel.id] || loadingPanels[selectedPanel.id]) return;
    setLoadingPanels((current) => ({ ...current, [selectedPanel.id]: true }));
    void fetchJson(selectedPanel.endpoint)
      .then((data) => {
        setPanelData((current) => ({ ...current, [selectedPanel.id]: data }));
        setPanelErrors((current) => ({ ...current, [selectedPanel.id]: undefined }));
      })
      .catch((fetchError: unknown) => setPanelErrors((current) => ({ ...current, [selectedPanel.id]: fetchError })))
      .finally(() => setLoadingPanels((current) => ({ ...current, [selectedPanel.id]: false })));
  }, [loadingPanels, panelData, runtimeStatus, selectedPanel]);

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

  async function lockBestie(): Promise<void> {
    if (!await confirmDialog({ title: "Khóa Bestie", description: "Bạn sẽ cần nhập mã mở khóa để tiếp tục dùng bảng điều khiển trên máy này.", confirmLabel: "Khóa ngay", cancelLabel: "Để sau" })) return;
    try {
      await fetchJson("/api/auth/logout", { method: "POST" });
      setCsrfToken(undefined);
      onLocked();
    } catch (error) {
      await alertDialog({ title: "Chưa thể khóa Bestie", description: error instanceof Error ? error.message : "Không thể kết thúc phiên hiện tại.", confirmLabel: "Đã hiểu", tone: "destructive" });
    }
  }

  if (!runtimeStatus) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Đang chuẩn bị Bestie...</div>;
  if (!runtimeStatus.ok || !runtimeStatus.config.exists) {
    return <OnboardingScreen onComplete={async () => {
      await fetchJson("/api/chat/sessions", { method: "POST", body: JSON.stringify({ title: "Cuộc trò chuyện đầu tiên" }) });
      setRuntimeStatus({ ok: true, config: { exists: true } });
      setPanelData({});
      setPanelErrors({});
      setLoadingPanels({});
      window.history.replaceState({}, "", "/chat");
      setActivePanel("chat");
    }} />;
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden p-3 md:p-5 lg:p-0">
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

        <aside className={cn("no-scrollbar fixed bottom-3 left-3 top-3 z-40 mb-0 flex overflow-y-auto rounded-[1.25rem] border border-white/10 bg-card/85 shadow-glow ring-1 ring-white/5 backdrop-blur-xl transition-all duration-300 sm:rounded-[1.5rem] lg:bottom-0 lg:left-[max(0px,calc((100vw-92rem)/2))] lg:top-0 lg:z-30 lg:rounded-none lg:border-y-0 lg:border-l-0 lg:shadow-none lg:ring-0", sidebarCollapsed ? "pointer-events-none w-[min(18rem,calc(100vw-1.5rem))] -translate-x-[calc(100%+1rem)] flex-col p-3 lg:pointer-events-auto lg:w-[4.75rem] lg:translate-x-0 lg:p-2.5" : "w-[min(18rem,calc(100vw-1.5rem))] translate-x-0 flex-col p-3 lg:w-[16rem] lg:p-4")} data-sidebar-state={sidebarCollapsed ? "collapsed" : "expanded"}>
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
          <div className={cn("mt-auto border-t border-white/10 pt-3", sidebarCollapsed ? "hidden lg:block" : "block")}>
            <Button
              aria-label="Khóa Bestie"
              className={cn("h-9 w-full justify-start rounded-xl text-muted-foreground hover:bg-secondary/70 hover:text-foreground", sidebarCollapsed ? "lg:justify-center lg:px-0" : "")}
              title={sidebarCollapsed ? "Khóa Bestie" : undefined}
              type="button"
              variant="ghost"
              onClick={() => void lockBestie()}
            >
              <LockKeyhole />
              <span className={cn(sidebarCollapsed ? "lg:sr-only" : "")}>Khóa Bestie</span>
            </Button>
            <p className={cn("mt-3 px-2 text-xs text-muted-foreground", sidebarCollapsed ? "hidden lg:block lg:px-0 lg:text-center" : "block")} title={updateSummary?.currentVersion ? `Bestie Agent v${updateSummary.currentVersion}` : "Bestie Agent"}>v{updateSummary?.currentVersion ?? "…"}</p>
          </div>
        </aside>

        <main className={cn("grid min-w-0 gap-4 transition-[margin] duration-300 lg:py-8 lg:pr-8 p-4", sidebarCollapsed ? "lg:ml-[4.75rem]" : "lg:ml-[16rem]")}>
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
              ) : selectedPanel.id === "models" || selectedPanel.id === "modelProviders" ? (
                activeError ? <ProviderPanelError error={activeError} /> : (
                  <ProviderPanel
                    data={activeData as unknown as ProviderSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    view={selectedPanel.id === "modelProviders" ? "providers" : "models"}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, models: data as unknown as JsonRecord, modelProviders: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, models: undefined, modelProviders: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, [selectedPanel.id]: loading }))}
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
                isChannelEditorRoute(activeRoute) ? <ChannelEditor channelId={activeRoute.slice("/channels/".length) as ChannelId} onBack={() => navigateToRoute("/channels")} /> : activeError ? <ChannelsPanelError error={activeError} /> : (
                  <ChannelsPanel
                    data={activeData as unknown as ChannelSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, channels: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, channels: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, channels: loading }))}
                    onNavigate={navigateToRoute}
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
              ) : selectedPanel.id === "logs" ? (
                activeError ? <LogsPanelError error={activeError} /> : (
                  <LogsPanel
                    data={activeData as unknown as LogsSummary | undefined}
                    loading={Boolean(loadingPanels[selectedPanel.id])}
                    onRefresh={() => {
                      setPanelData((current) => { const next = { ...current }; delete next.logs; return next; });
                      setPanelErrors((current) => ({ ...current, logs: undefined }));
                    }}
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
                    page={activeRoute}
                    onNavigate={(route) => {
                      window.history.pushState({ panelId: "settings" }, "", route);
                      setActivePanel("settings");
                      setActiveRoute(route);
                    }}
                    onData={(data) => {
                      setPanelData((current) => ({ ...current, settings: data as unknown as JsonRecord }));
                      setPanelErrors((current) => ({ ...current, settings: undefined }));
                    }}
                    onLoading={(loading) => setLoadingPanels((current) => ({ ...current, settings: loading }))}
                    onStatusRefresh={refreshStatus}
                    onLocked={onLocked}
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
