import type { FormEvent, ReactElement, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Bot, BriefcaseBusiness, ChevronRight, Play, Plus, RefreshCw, Trash2, UserPlus, Users, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, formatError } from "@/lib/api";
import { confirmDialog } from "@/lib/dialogs";
import { ToastEffect } from "@/lib/toasts";
import { cn } from "@/lib/utils";
import type { AgentAvailableTool, AgentsActionResult, AgentsSummary, PublicAgentPolicy, WorkforceAgent, WorkforceAgentChannel, WorkforceApprovalPolicy, WorkforceTask, WorkforceTaskStatus } from "./types";

interface AgentsPanelProps {
  data?: AgentsSummary;
  loading: boolean;
  onData: (data: AgentsSummary) => void;
  onLoading: (loading: boolean) => void;
}

interface HireDraft {
  id: string;
  displayName: string;
  role: string;
  description: string;
  model: string;
  tools: string[];
  approvalPolicy: WorkforceApprovalPolicy;
  public?: PublicAgentPolicy | null;
}

interface TaskDraft {
  agentId: string;
  title: string;
  brief: string;
}

type AgentsChildPage = "team" | "tasks";
type AgentsDrawer = "hire" | "edit" | "assign" | null;

const emptyHireDraft: HireDraft = { id: "", displayName: "", role: "", description: "", model: "", tools: [], approvalPolicy: "ask-for-external-actions" };

export function AgentsPanel({ data, loading, onData, onLoading }: AgentsPanelProps): ReactElement {
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<AgentsDrawer>(null);
  const [hireDraft, setHireDraft] = useState<HireDraft>(emptyHireDraft);
  const [editAgentId, setEditAgentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<HireDraft>(emptyHireDraft);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({ agentId: "", title: "", brief: "" });
  const [taskFilter, setTaskFilter] = useState<WorkforceTaskStatus | "all">("all");
  const [childPage, setChildPage] = useState<AgentsChildPage>(() => pageFromPath(window.location.pathname));

  const activeAgents = useMemo(() => data?.agents.filter((agent) => agent.enabled) ?? [], [data?.agents]);
  const visibleTasks = useMemo(() => data?.tasks.filter((task) => taskFilter === "all" || task.status === taskFilter) ?? [], [data?.tasks, taskFilter]);

  useEffect(() => {
    function handlePopState(): void {
      setChildPage(pageFromPath(window.location.pathname));
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  async function runAction(action: () => Promise<AgentsActionResult | AgentsSummary>, success?: string): Promise<void> {
    setActionError(null);
    setActionMessage(null);
    onLoading(true);
    try {
      const result = await action();
      onData(result);
      const messages = "messages" in result ? result.messages : [];
      setActionMessage(success ?? messages[0] ?? null);
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      onLoading(false);
    }
  }

  function navigateChild(page: AgentsChildPage): void {
    const path = page === "tasks" ? "/agents/tasks" : "/agents";
    setChildPage(page);
    if (window.location.pathname !== path) window.history.pushState({ panelId: "agents", agentsPage: page }, "", `${path}${window.location.search}`);
  }

  async function reload(): Promise<void> {
    await runAction(() => fetchJson<AgentsSummary>("/api/agents"));
  }

  async function submitHire(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!await confirmDialog({ title: "Tạo agent mới?", description: `${hireDraft.displayName || hireDraft.id} sẽ được thêm vào đội agent cố định.`, confirmLabel: "Tạo agent", cancelLabel: "Huỷ" })) return;
    await runAction(() => postAgentsAction({
      action: "hire",
      id: hireDraft.id,
      displayName: hireDraft.displayName,
      role: hireDraft.role,
      description: hireDraft.description,
      model: hireDraft.model.trim() || undefined,
      tools: hireDraft.tools,
      approvalPolicy: hireDraft.approvalPolicy,
      confirm: true,
    }), "Đã thêm agent mới.");
    setHireDraft(emptyHireDraft);
    setDrawer(null);
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editAgentId) return;
    if (!await confirmDialog({ title: "Lưu thay đổi agent?", description: `${editDraft.displayName || editAgentId} sẽ được cập nhật trong đội agent.`, confirmLabel: "Lưu", cancelLabel: "Huỷ" })) return;
    await runAction(() => postAgentsAction({
      action: "update",
      id: editAgentId,
      displayName: editDraft.displayName,
      role: editDraft.role,
      description: editDraft.description,
      model: editDraft.model.trim(),
      tools: editDraft.tools,
      approvalPolicy: editDraft.approvalPolicy,
      public: editDraft.public,
      confirm: true,
    }), "Đã cập nhật agent.");
    setEditAgentId(null);
    setEditDraft(emptyHireDraft);
    setDrawer(null);
  }

  function openEdit(agent: WorkforceAgent): void {
    setEditAgentId(agent.id);
    setEditDraft({
      id: agent.id,
      displayName: agent.displayName,
      role: agent.role,
      description: agent.description,
      model: agent.model ?? "",
      tools: agent.tools ?? [],
      approvalPolicy: agent.approvalPolicy,
      public: agent.public ?? null,
    });
    setDrawer("edit");
  }

  async function submitTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const agentId = taskDraft.agentId || activeAgents[0]?.id || "";
    if (!await confirmDialog({ title: "Giao việc cho agent?", description: taskDraft.title || taskDraft.brief, confirmLabel: "Giao việc", cancelLabel: "Huỷ" })) return;
    await runAction(() => postAgentsAction({ action: "assign", agentId, title: taskDraft.title.trim() || undefined, brief: taskDraft.brief, confirm: true }), "Đã đưa việc vào hàng đợi.");
    setTaskDraft({ agentId, title: "", brief: "" });
    setDrawer(null);
    navigateChild("tasks");
  }

  async function setAgentState(agent: WorkforceAgent, enabled: boolean): Promise<void> {
    if (!await confirmDialog(`${enabled ? "Kích hoạt" : "Tạm dừng"} ${agent.displayName}?`)) return;
    await runAction(() => postAgentsAction({ action: enabled ? "resume" : "pause", id: agent.id, confirm: true }));
  }

  async function removeAgent(agent: WorkforceAgent): Promise<void> {
    if (!await confirmDialog({ title: `Gỡ ${agent.displayName}?`, description: "Prompt file vẫn được giữ lại trên máy để tiện kiểm tra lịch sử.", confirmLabel: "Gỡ agent", cancelLabel: "Huỷ" })) return;
    await runAction(() => postAgentsAction({ action: "remove", id: agent.id, confirm: true }));
  }

  async function setChannelBinding(agent: WorkforceAgent, channel: WorkforceAgentChannel, bind: boolean): Promise<void> {
    const channelName = formatAgentChannel(channel);
    const description = bind
      ? `${channelName} sẽ chuyển mọi tin nhắn mới sang ${agent.displayName}. Binding agent hiện tại của channel này (nếu có) sẽ được thay thế.`
      : `${channelName} sẽ quay lại dùng Bestie mặc định.`;
    if (!await confirmDialog({ title: bind ? `Gán ${channelName}?` : `Gỡ ${channelName}?`, description, confirmLabel: bind ? "Gán channel" : "Gỡ binding", cancelLabel: "Huỷ" })) return;
    await runAction(() => postAgentsAction({ action: bind ? "bind_channel" : "unbind_channel", id: agent.id, channel, confirm: true }));
  }

  async function daemon(action: "daemon_start" | "daemon_stop" | "daemon_restart"): Promise<void> {
    const label = action === "daemon_start" ? "Bật xử lý nền" : action === "daemon_stop" ? "Dừng xử lý nền" : "Khởi động lại xử lý nền";
    if (!await confirmDialog(`${label} cho đội agent?`)) return;
    await runAction(() => postAgentsAction({ action, confirm: true }));
  }

  async function runQueue(): Promise<void> {
    if (!await confirmDialog("Chạy việc đang chờ ngay bây giờ?")) return;
    await runAction(() => postAgentsAction({ action: "run", limit: 3, confirm: true }));
  }

  if (!data) {
    return <Alert className="border-accent/40 bg-accent/10"><Users className="size-4" /><AlertTitle>Đang tải đội agent</AlertTitle><AlertDescription>Đang tải danh sách agent cố định và hàng đợi công việc.</AlertDescription></Alert>;
  }

  return (
    <div className="grid gap-4">
      {actionError ? <ToastEffect title="Không thể cập nhật đội agent" description={actionError} tone="error" onShown={() => setActionError(null)} /> : null}
      {actionMessage ? <ToastEffect title="Đội agent đã cập nhật" description={actionMessage} tone="success" onShown={() => setActionMessage(null)} /> : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <AgentsPageTabs active={childPage} onNavigate={navigateChild} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Tải lại</Button>
          <Button variant="secondary" onClick={() => setDrawer("assign")} disabled={loading || activeAgents.length === 0}><BriefcaseBusiness /> Giao việc</Button>
          <Button onClick={() => setDrawer("hire")} disabled={loading}><Plus /> Tạo agent mới</Button>
        </div>
      </div>

      {childPage === "tasks" ? (
        <TasksPage data={data} visibleTasks={visibleTasks} taskFilter={taskFilter} loading={loading} onFilter={setTaskFilter} onRunQueue={runQueue} onDaemon={daemon} />
      ) : (
        <TeamPage data={data} loading={loading} onAgentState={setAgentState} onRemoveAgent={removeAgent} onChannelBinding={setChannelBinding} onOpenEdit={openEdit} onOpenAssign={(agentId) => { setTaskDraft((current) => ({ ...current, agentId })); setDrawer("assign"); }} />
      )}

      <RightDrawer title="Tạo agent mới" description="Tạo một vai trò cố định để Bestie có thể giao việc lâu dài." open={drawer === "hire"} onClose={() => setDrawer(null)}>
        <HireForm draft={hireDraft} tools={data.availableTools} loading={loading} onDraft={setHireDraft} onSubmit={submitHire} />
      </RightDrawer>

      <RightDrawer title="Sửa agent" description="Cập nhật tên, vai trò, model, quyền thao tác và danh sách công cụ được phép." open={drawer === "edit"} onClose={() => setDrawer(null)}>
        <AgentProfileForm draft={editDraft} tools={data.availableTools} loading={loading} submitLabel="Lưu thay đổi" onDraft={setEditDraft} onSubmit={submitEdit} idLocked />
      </RightDrawer>

      <RightDrawer title="Giao việc" description="Việc được đưa vào hàng đợi, xử lý thủ công hoặc bởi daemon workforce." open={drawer === "assign"} onClose={() => setDrawer(null)}>
        <TaskForm draft={taskDraft} agents={activeAgents} loading={loading || activeAgents.length === 0} onDraft={setTaskDraft} onSubmit={submitTask} />
      </RightDrawer>
    </div>
  );
}

function TeamPage({ data, loading, onAgentState, onRemoveAgent, onChannelBinding, onOpenEdit, onOpenAssign }: { data: AgentsSummary; loading: boolean; onAgentState: (agent: WorkforceAgent, enabled: boolean) => Promise<void>; onRemoveAgent: (agent: WorkforceAgent) => Promise<void>; onChannelBinding: (agent: WorkforceAgent, channel: WorkforceAgentChannel, bind: boolean) => Promise<void>; onOpenEdit: (agent: WorkforceAgent) => void; onOpenAssign: (agentId: string) => void }): ReactElement {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Đang hoạt động" value={String(data.counts.activeAgents)} tone="good" />
        <Metric label="Tạm dừng" value={String(data.counts.pausedAgents)} tone={data.counts.pausedAgents ? "warn" : "neutral"} />
        <Metric label="Tổng agent" value={String(data.agents.length)} />
        <Metric label="Việc đang chờ" value={String(data.counts.queuedTasks)} tone={data.counts.queuedTasks ? "warn" : "neutral"} />
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="size-5" /> Đội agent</CardTitle>
          <CardDescription>Agent cố định có vai trò, prompt, model, channel chat và hàng đợi việc riêng.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.agents.length ? data.agents.map((agent) => <AgentCard key={agent.id} agent={agent} loading={loading} onState={onAgentState} onRemove={onRemoveAgent} onChannelBinding={onChannelBinding} onEdit={onOpenEdit} onAssign={onOpenAssign} />) : <EmptyBox>Chưa có agent cố định nào. Bấm “Tạo agent mới” để bắt đầu.</EmptyBox>}
        </CardContent>
      </Card>
    </div>
  );
}

function TasksPage({ data, visibleTasks, taskFilter, loading, onFilter, onRunQueue, onDaemon }: { data: AgentsSummary; visibleTasks: WorkforceTask[]; taskFilter: WorkforceTaskStatus | "all"; loading: boolean; onFilter: (filter: WorkforceTaskStatus | "all") => void; onRunQueue: () => Promise<void>; onDaemon: (action: "daemon_start" | "daemon_stop" | "daemon_restart") => Promise<void> }): ReactElement {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Đang chờ" value={String(data.counts.queuedTasks)} tone={data.counts.queuedTasks ? "warn" : "neutral"} />
        <Metric label="Đang chạy" value={String(data.counts.runningTasks)} tone={data.counts.runningTasks ? "good" : "neutral"} />
        <Metric label="Bị chặn" value={String(data.counts.blockedTasks)} tone={data.counts.blockedTasks ? "warn" : "neutral"} />
        <Metric label="Xử lý nền" value={formatDaemonState(data.daemon.state)} tone={data.daemon.state === "running" ? "good" : "neutral"} />
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div><CardTitle className="flex items-center gap-2"><Bot className="size-5" /> Hàng đợi công việc</CardTitle><CardDescription>Theo dõi việc đang chờ, đang chạy, hoàn tất hoặc bị chặn.</CardDescription></div>
          <div className="flex flex-wrap gap-2">
            <Select value={taskFilter} onChange={(event) => onFilter(event.target.value as WorkforceTaskStatus | "all")} className="w-40"><option value="all">Tất cả</option><option value="queued">Đang chờ</option><option value="in_progress">Đang chạy</option><option value="done">Hoàn tất</option><option value="blocked">Bị chặn</option><option value="canceled">Đã huỷ</option></Select>
            <Button variant="secondary" onClick={() => void onRunQueue()} disabled={loading || data.counts.queuedTasks === 0}><Play /> Chạy hàng đợi</Button>
            <Button variant="outline" onClick={() => void onDaemon(data.daemon.state === "running" ? "daemon_stop" : "daemon_start")} disabled={loading}>{data.daemon.state === "running" ? "Dừng nền" : "Bật nền"}</Button>
            <Button variant="outline" onClick={() => void onDaemon("daemon_restart")} disabled={loading || data.daemon.state !== "running"}>Khởi động lại</Button>
          </div>
        </CardHeader>
        <CardContent className="grid max-h-[min(68vh,760px)] gap-3 overflow-auto pr-1">
          {visibleTasks.length ? visibleTasks.map((task) => <TaskCard key={task.id} task={task} />) : <EmptyBox>Chưa có việc phù hợp với bộ lọc hiện tại.</EmptyBox>}
        </CardContent>
      </Card>
    </div>
  );
}

export function AgentsPanelError({ error }: { error: unknown }): ReactElement {
  return <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Không tải được đội agent</AlertTitle><AlertDescription>{formatError(error)}</AlertDescription></Alert>;
}

function AgentsPageTabs({ active, onNavigate }: { active: AgentsChildPage; onNavigate: (page: AgentsChildPage) => void }): ReactElement {
  return <div className="flex w-fit rounded-2xl border border-white/10 bg-background/35 p-1"><Button variant={active === "team" ? "secondary" : "ghost"} size="sm" onClick={() => onNavigate("team")}>Đội agent</Button><Button variant={active === "tasks" ? "secondary" : "ghost"} size="sm" onClick={() => onNavigate("tasks")}>Hàng đợi công việc <ChevronRight className="size-4" /></Button></div>;
}

function RightDrawer({ title, description, open, onClose, children }: { title: string; description: string; open: boolean; onClose: () => void; children: ReactNode }): ReactElement | null {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-background shadow-2xl animate-in slide-in-from-right duration-200">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-4">
          <div><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Đóng"><X /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </aside>
    </div>
  );
}

function HireForm({ draft, tools, loading, onDraft, onSubmit }: { draft: HireDraft; tools: AgentAvailableTool[]; loading: boolean; onDraft: (draft: HireDraft) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> }): ReactElement {
  return <AgentProfileForm draft={draft} tools={tools} loading={loading} submitLabel="Tạo agent" onDraft={onDraft} onSubmit={onSubmit} />;
}

function AgentProfileForm({ draft, tools, loading, submitLabel, idLocked = false, onDraft, onSubmit }: { draft: HireDraft; tools: AgentAvailableTool[]; loading: boolean; submitLabel: string; idLocked?: boolean; onDraft: (draft: HireDraft) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> }): ReactElement {
  const publicPolicy = draft.public;
  const unsafe = publicPolicy?.customerMemory === "primary" || publicPolicy?.knowledgeAccess === "primary";
  const updatePublic = (changes: Partial<PublicAgentPolicy>) => onDraft({ ...draft, public: { enabled: true, customerMemory: "isolated", customerMemoryWrite: "pending", knowledgeAccess: "agent-only", ...publicPolicy, ...changes } });
  return <form className="grid gap-3" onSubmit={(event) => void onSubmit(event)}><FormField label="Mã agent"><Input value={draft.id} onChange={(event) => onDraft({ ...draft, id: event.target.value })} placeholder="researcher" disabled={idLocked} required /></FormField><FormField label="Tên hiển thị"><Input value={draft.displayName} onChange={(event) => onDraft({ ...draft, displayName: event.target.value })} placeholder="Mika" required /></FormField><FormField label="Vai trò"><Input value={draft.role} onChange={(event) => onDraft({ ...draft, role: event.target.value })} placeholder="Trợ lý nghiên cứu" required /></FormField><FormField label="Mô tả"><Textarea value={draft.description} onChange={(event) => onDraft({ ...draft, description: event.target.value })} placeholder="Nghiên cứu, tổng hợp và đưa ra đề xuất." required /></FormField><FormField label="Model riêng (tuỳ chọn)"><Input value={draft.model} onChange={(event) => onDraft({ ...draft, model: event.target.value })} placeholder="openai/gpt-4.1-mini" /></FormField><ToolCheckboxPicker tools={tools} selected={draft.tools} onSelected={(selected) => onDraft({ ...draft, tools: selected })} /><FormField label="Quyền thao tác"><Select value={draft.approvalPolicy} onChange={(event) => onDraft({ ...draft, approvalPolicy: event.target.value as WorkforceApprovalPolicy })}><option value="ask-for-external-actions">Hỏi trước thao tác bên ngoài</option><option value="ask-for-all-actions">Hỏi trước mọi thao tác</option><option value="deny-external-actions">Chặn thao tác bên ngoài</option></Select></FormField>{idLocked ? <div className="grid gap-3 rounded-2xl border border-white/10 bg-background/35 p-3"><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={Boolean(publicPolicy)} onChange={(event) => onDraft({ ...draft, public: event.target.checked ? { enabled: true, customerMemory: "isolated", customerMemoryWrite: "pending", knowledgeAccess: "agent-only", toolPolicy: "deny" } : null })} /> Agent công khai</label>{publicPolicy ? <><p className="text-xs text-muted-foreground">Cho phép người dùng bên ngoài trao đổi với agent qua channel public. Mặc định tách riêng từng người dùng, chỉ dùng tri thức của agent và chặn tools. Lệnh quản trị/approval không dùng được trong channel công khai.</p><FormField label="Bộ nhớ theo người dùng"><Select value={publicPolicy.customerMemory ?? "isolated"} onChange={(event) => updatePublic({ customerMemory: event.target.value as "isolated" | "primary" })}><option value="isolated">Cách ly theo người dùng</option><option value="primary">Dùng bộ nhớ primary</option></Select></FormField><FormField label="Ghi bộ nhớ theo người dùng"><Select value={publicPolicy.customerMemoryWrite ?? "pending"} onChange={(event) => updatePublic({ customerMemoryWrite: event.target.value as "deny" | "pending" | "allow" })}><option value="pending">Chờ duyệt</option><option value="deny">Không ghi</option><option value="allow">Tự ghi</option></Select></FormField><FormField label="Knowledge base"><Select value={publicPolicy.knowledgeAccess ?? "agent-only"} onChange={(event) => updatePublic({ knowledgeAccess: event.target.value as "agent-only" | "none" | "primary" })}><option value="agent-only">Chỉ knowledge của agent</option><option value="none">Không dùng knowledge</option><option value="primary">Dùng knowledge primary</option></Select></FormField><FormField label="Chính sách tools"><Select value={publicPolicy.toolPolicy ?? "deny"} onChange={(event) => updatePublic({ toolPolicy: event.target.value as "deny" | "allowlist" })}><option value="deny">Chặn toàn bộ</option><option value="allowlist">Dùng allowlist agent</option></Select></FormField>{unsafe ? <label className="flex items-start gap-2 text-xs text-destructive"><input type="checkbox" checked={publicPolicy.allowUnsafeSharedData === true} onChange={(event) => updatePublic({ allowUnsafeSharedData: event.target.checked })} /> Tôi hiểu lựa chọn này có thể lộ dữ liệu/tools dùng chung.</label> : null}</> : null}</div> : null}<Button type="submit" disabled={loading || (unsafe && publicPolicy?.allowUnsafeSharedData !== true)}><UserPlus /> {submitLabel}</Button></form>;
}

function ToolCheckboxPicker({ tools, selected, onSelected }: { tools: AgentAvailableTool[]; selected: string[]; onSelected: (selected: string[]) => void }): ReactElement {
  const selectedSet = new Set(selected);
  const categories = Array.from(new Set(tools.map((tool) => tool.category)));
  const allSelected = tools.length > 0 && selected.length === tools.length;
  function toggle(toolName: string): void {
    onSelected(selectedSet.has(toolName) ? selected.filter((name) => name !== toolName) : [...selected, toolName].sort());
  }
  function toggleAll(): void {
    onSelected(allSelected ? [] : tools.map((tool) => tool.name).sort());
  }
  return <div className="grid gap-2"><div className="flex flex-wrap items-center justify-between gap-2"><Label>Công cụ cho phép</Label><div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Đã chọn {selected.length}/{tools.length}</span><Button type="button" variant="outline" size="sm" onClick={toggleAll} disabled={!tools.length}>{allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}</Button></div></div><div className="max-h-[22rem] overflow-auto rounded-2xl border border-white/10 bg-background/35 p-3"><div className="grid gap-4">{categories.map((category) => <div key={category} className="grid gap-2"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{category}</p><div className="grid gap-2">{tools.filter((tool) => tool.category === category).map((tool) => <label key={tool.name} className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-card/50 p-3 text-sm transition-colors hover:bg-secondary/40"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={selectedSet.has(tool.name)} onChange={() => toggle(tool.name)} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-medium">{tool.label}</span><Badge variant={tool.risk === "high" ? "destructive" : tool.risk === "medium" ? "outline" : "secondary"}>{formatRisk(tool.risk)}</Badge></span><span className="mt-1 block break-all text-xs text-muted-foreground">{tool.name}</span><span className="mt-1 block text-xs text-muted-foreground">{tool.description}</span></span></label>)}</div></div>)}</div></div><p className="text-xs text-muted-foreground">Nếu không chọn tool nào, agent sẽ không có giới hạn riêng và dùng quyền mặc định của Bestie.</p></div>;
}

function TaskForm({ draft, agents, loading, onDraft, onSubmit }: { draft: TaskDraft; agents: WorkforceAgent[]; loading: boolean; onDraft: (draft: TaskDraft) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> }): ReactElement {
  return <form className="grid gap-3" onSubmit={(event) => void onSubmit(event)}><FormField label="Agent nhận việc"><Select value={draft.agentId || agents[0]?.id || ""} onChange={(event) => onDraft({ ...draft, agentId: event.target.value })} disabled={!agents.length}>{agents.length ? agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName} · {agent.role}</option>) : <option value="">Chưa có agent đang hoạt động</option>}</Select></FormField><FormField label="Tên việc"><Input value={draft.title} onChange={(event) => onDraft({ ...draft, title: event.target.value })} placeholder="Tóm tắt thị trường tuần này" /></FormField><FormField label="Yêu cầu chi tiết"><Textarea value={draft.brief} onChange={(event) => onDraft({ ...draft, brief: event.target.value })} placeholder="Mô tả rõ đầu ra mong muốn, nguồn tham khảo và deadline nếu có." className="min-h-40" required /></FormField><Button type="submit" disabled={loading}><BriefcaseBusiness /> Giao việc</Button></form>;
}

function AgentCard({ agent, loading, onState, onRemove, onChannelBinding, onEdit, onAssign }: { agent: WorkforceAgent; loading: boolean; onState: (agent: WorkforceAgent, enabled: boolean) => Promise<void>; onRemove: (agent: WorkforceAgent) => Promise<void>; onChannelBinding: (agent: WorkforceAgent, channel: WorkforceAgentChannel, bind: boolean) => Promise<void>; onEdit: (agent: WorkforceAgent) => void; onAssign: (agentId: string) => void }): ReactElement {
  return <article className="rounded-2xl border border-white/10 bg-card/60 p-4 text-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-lg font-semibold">{agent.displayName}</p><p className="text-muted-foreground">{agent.id} · {agent.role}</p></div><Badge variant={agent.enabled ? "secondary" : "destructive"}>{agent.enabled ? "đang hoạt động" : "tạm dừng"}</Badge></div><p className="mt-3 text-muted-foreground">{agent.description}</p><Separator className="my-3" /><div className="grid gap-1 text-xs text-muted-foreground"><p>Model: {agent.model || "mặc định"}</p><p>Bộ nhớ: {agent.memoryScope}</p><p>Prompt: {agent.promptPath}</p><p>Công cụ: {agent.tools?.length ? agent.tools.join(", ") : "chưa giới hạn riêng"}</p></div><div className="mt-3 grid gap-2"><p className="text-xs font-medium text-muted-foreground">Channel trò chuyện</p><div className="flex flex-wrap gap-2">{AGENT_CHANNELS.map((channel) => { const bound = agent.channels?.includes(channel.id) ?? false; return <Button key={channel.id} size="sm" variant={bound ? "secondary" : "outline"} onClick={() => void onChannelBinding(agent, channel.id, !bound)} disabled={loading}>{bound ? `Gỡ ${channel.label}` : `Gán ${channel.label}`}</Button>; })}</div><p className="text-xs text-muted-foreground">{agent.channels?.length ? `Đang nhận: ${agent.channels.map(formatAgentChannel).join(", ")}` : "Chưa gán channel; các channel vẫn dùng Bestie mặc định."}</p></div><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => onAssign(agent.id)} disabled={loading || !agent.enabled}><BriefcaseBusiness /> Giao việc</Button><Button size="sm" variant="outline" onClick={() => onEdit(agent)} disabled={loading}>Sửa</Button><Button size="sm" variant="outline" onClick={() => void onState(agent, !agent.enabled)} disabled={loading}>{agent.enabled ? "Tạm dừng" : "Kích hoạt"}</Button><Button size="sm" variant="outline" onClick={() => void onRemove(agent)} disabled={loading}><Trash2 /> Gỡ</Button></div></article>;
}

const AGENT_CHANNELS: Array<{ id: WorkforceAgentChannel; label: string }> = [
  { id: "telegram", label: "Telegram" },
  { id: "zalo", label: "Zalo" },
  { id: "zalo-personal", label: "Zalo Personal" },
];

function TaskCard({ task }: { task: WorkforceTask }): ReactElement {
  return <article className="rounded-2xl border border-white/10 bg-card/60 p-4 text-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{task.title}</p><p className="text-muted-foreground">{task.agentId} · {formatDate(task.createdAt)}</p></div><Badge variant={task.status === "blocked" ? "destructive" : task.status === "done" ? "secondary" : "outline"}>{formatTaskStatus(task.status)}</Badge></div><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{task.brief}</p>{task.result ? <p className="mt-3 whitespace-pre-wrap rounded-xl border border-white/10 bg-background/40 p-3">{task.result}</p> : null}</article>;
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "warn" | "neutral" }): ReactElement {
  const className = tone === "good" ? "text-primary" : tone === "warn" ? "text-accent" : "text-foreground";
  return <Card className="border-white/10 bg-background/35"><CardContent className="p-4"><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className={cn("mt-2 text-2xl font-semibold", className)}>{value}</p></CardContent></Card>;
}

function FormField({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return <div className="grid gap-2"><Label>{label}</Label>{children}</div>;
}

function EmptyBox({ children }: { children: string }): ReactElement {
  return <p className="rounded-2xl border border-dashed border-white/10 bg-background/25 p-4 text-sm text-muted-foreground">{children}</p>;
}

function postAgentsAction(body: Record<string, unknown>): Promise<AgentsActionResult> {
  return fetchJson<AgentsActionResult>("/api/agents/action", { method: "POST", body: JSON.stringify(body) });
}

function pageFromPath(pathname: string): AgentsChildPage {
  return pathname.replace(/\/+$/, "") === "/agents/tasks" ? "tasks" : "team";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDaemonState(state: string): string {
  if (state === "running") return "đang chạy";
  if (state === "stale") return "cần kiểm tra";
  return "đã dừng";
}

function formatTaskStatus(status: WorkforceTaskStatus): string {
  if (status === "queued") return "đang chờ";
  if (status === "in_progress") return "đang chạy";
  if (status === "done") return "hoàn tất";
  if (status === "blocked") return "bị chặn";
  return "đã huỷ";
}

function formatAgentChannel(channel: WorkforceAgentChannel): string {
  return AGENT_CHANNELS.find((item) => item.id === channel)?.label ?? channel;
}

function formatRisk(risk: AgentAvailableTool["risk"]): string {
  if (risk === "high") return "rủi ro cao";
  if (risk === "medium") return "cần cân nhắc";
  return "an toàn";
}
