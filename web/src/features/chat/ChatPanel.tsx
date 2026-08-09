import type { CSSProperties, FormEvent, KeyboardEvent, ReactElement, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Bot, Check, Copy, FileText, GitFork, Loader2, Maximize2, MessageSquareText, Minimize2, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Paperclip, Pencil, Pin, Plus, RefreshCw, RotateCcw, Search, Send, Settings2, Trash2, User, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, formatError } from "@/lib/api";
import { confirmDialog, promptDialog } from "@/lib/dialogs";
import { ToastEffect } from "@/lib/toasts";
import type { ChatAttachment, ChatEvent, ChatMessage, ChatRun, ChatSession, ChatSessionMessagesSummary, ChatSessionsSummary, ChatStreamDoneResult, ChatTimelineEvent } from "./types";

interface ChatAttachmentDraft {
  name: string;
  type?: string;
  size: number;
  content: string;
}

interface ChatProviderSummary {
  ok: boolean;
  primary?: { modelRef: string };
  models: Array<{ modelRef: string; primary: boolean; fallback: boolean }>;
}

interface ChatSettingsSummary {
  ok: boolean;
  agent?: { name?: string };
}

interface ChatPanelProps {
  data?: ChatSessionsSummary;
  loading: boolean;
  onData: (data: ChatSessionsSummary) => void;
  onLoading: (loading: boolean) => void;
}

type ChatFilter = "all" | "approval" | "cancelled" | "error" | "fork" | "retry";
const CHAT_SESSIONS_COLLAPSED_KEY = "bestie.chat.sessionsCollapsed";
const CHAT_CONTROLS_COLLAPSED_KEY = "bestie.chat.controlsCollapsed";

export function ChatPanel({ data, loading, onData, onLoading }: ChatPanelProps): ReactElement {
  const [activeSession, setActiveSession] = useState<ChatSessionMessagesSummary | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachmentDraft[]>([]);
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [providerModelRef, setProviderModelRef] = useState("");
  const [providerModels, setProviderModels] = useState<ChatProviderSummary["models"]>([]);
  const [agentName, setAgentName] = useState("Bestie");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [timeline, setTimeline] = useState<ChatTimelineEvent[]>([]);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(() => readStoredBoolean(CHAT_SESSIONS_COLLAPSED_KEY));
  const [controlsCollapsed, setControlsCollapsed] = useState(() => readStoredBoolean(CHAT_CONTROLS_COLLAPSED_KEY));
  const [mobileSheet, setMobileSheet] = useState<"sessions" | "controls" | null>(null);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const sessions = data?.sessions ?? [];
  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt)) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [sessions]);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void fetchJson<ChatProviderSummary>("/api/providers").then((summary) => {
      setProviderModels(summary.models ?? []);
      setProviderModelRef((current) => current || summary.primary?.modelRef || "");
    }).catch(() => undefined);
    void fetchJson<ChatSettingsSummary>("/api/settings").then((summary) => {
      if (summary.agent?.name) setAgentName(summary.agent.name);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (activeSession || sortedSessions.length === 0) return;
    void openSession(sortedSessions[0].id);
  }, [activeSession, sortedSessions]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [activeSession?.session.id, visibleMessageKey(activeSession?.messages ?? []), streamText]);

  useEffect(() => {
    writeStoredBoolean(CHAT_SESSIONS_COLLAPSED_KEY, sessionsCollapsed);
  }, [sessionsCollapsed]);

  useEffect(() => {
    writeStoredBoolean(CHAT_CONTROLS_COLLAPSED_KEY, controlsCollapsed);
  }, [controlsCollapsed]);

  async function refreshSessions(): Promise<ChatSessionsSummary> {
    const next = await fetchJson<ChatSessionsSummary>("/api/chat/sessions");
    onData(next);
    return next;
  }

  async function runRequest<T>(request: () => Promise<T>, options: { globalLoading?: boolean; success?: string } = {}): Promise<T | undefined> {
    setActionError(null);
    setActionMessage(null);
    if (options.globalLoading) onLoading(true);
    try {
      const result = await request();
      if (options.success) setActionMessage(options.success);
      return result;
    } catch (error: unknown) {
      setActionError(formatError(error));
      return undefined;
    } finally {
      if (options.globalLoading) onLoading(false);
    }
  }

  async function searchSessions(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();
    const path = `/api/chat/search?filter=${encodeURIComponent(filter)}${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`;
    const result = await runRequest(() => fetchJson<ChatSessionsSummary>(path), { globalLoading: true });
    if (result) onData(result);
  }

  async function reload(): Promise<void> {
    const next = await runRequest(refreshSessions, { globalLoading: true });
    if (activeSession && next?.sessions.some((session) => session.id === activeSession.session.id)) await openSession(activeSession.session.id);
  }

  async function openSession(id: number): Promise<void> {
    const result = await runRequest(() => fetchJson<ChatSessionMessagesSummary>(`/api/chat/session?id=${id}`));
    if (!result) return;
    setActiveSession(result);
    setToolsEnabled(result.session.toolsEnabled !== false);
    setMemoryEnabled(result.session.memoryEnabled !== false);
    setProviderModelRef(result.session.providerModelRef ?? "");
    setStreamText("");
    setTimeline([]);
  }

  async function createSession(): Promise<void> {
    const title = await promptDialog({ title: "Chat mới", description: "Đặt tên cho cuộc trò chuyện này.", defaultValue: "Chat mới", confirmLabel: "Tạo" }) ?? undefined;
    const result = await runRequest(() => fetchJson<ChatSessionMessagesSummary>("/api/chat/sessions", { method: "POST", body: JSON.stringify({ title }) }), { globalLoading: true, success: "Đã tạo cuộc trò chuyện." });
    if (!result) return;
    setActiveSession(result);
    await refreshSessions();
  }

  async function createSessionForMessage(content: string): Promise<ChatSessionMessagesSummary | undefined> {
    const title = content.trim().slice(0, 48) || "Chat mới";
    const result = await runRequest(() => fetchJson<ChatSessionMessagesSummary>("/api/chat/sessions", { method: "POST", body: JSON.stringify({ title }) }), { globalLoading: true });
    if (result) {
      setActiveSession(result);
      await refreshSessions();
    }
    return result;
  }

  async function updateSession(body: Record<string, unknown>, success: string): Promise<void> {
    if (!activeSession) return;
    const result = await runRequest(() => fetchJson<ChatSessionMessagesSummary>("/api/chat/session", { method: "PUT", body: JSON.stringify({ id: activeSession.session.id, ...body }) }), { success });
    if (!result) return;
    setActiveSession(result);
    await refreshSessions();
  }

  function startEditingTitle(): void {
    if (!activeSession) return;
    setDraftTitle(activeSession.session.title);
    setEditingTitle(true);
  }

  async function saveTitle(): Promise<void> {
    const title = draftTitle.trim();
    if (!activeSession || !title) return;
    setEditingTitle(false);
    await updateSession({ title }, "Đã đổi tên cuộc trò chuyện.");
  }

  async function deleteSession(): Promise<void> {
    if (!activeSession || !await confirmDialog({ title: "Xoá cuộc trò chuyện", description: `Xoá cuộc trò chuyện #${activeSession.session.id}?`, confirmLabel: "Xoá", tone: "destructive" })) return;
    await runRequest(() => fetchJson<ChatSessionMessagesSummary>("/api/chat/sessions/delete", { method: "POST", body: JSON.stringify({ id: activeSession.session.id, confirm: true }) }), { globalLoading: true, success: "Đã xoá cuộc trò chuyện." });
    setActiveSession(null);
    await refreshSessions();
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || streaming) return;
    const targetSession = activeSession ?? await createSessionForMessage(trimmed);
    const sessionId = targetSession?.session.id;
    setMessage("");
    setAttachments([]);
    setStreamText("");
    setTimeline([]);
    setStreaming(true);
    setActionError(null);
    const optimisticUser: ChatMessageWithAttachments = { id: Date.now(), sessionId: sessionId ?? 0, role: "user", content: trimmed, attachments, createdAt: new Date().toISOString() };
    if (targetSession) setActiveSession({ ...targetSession, messages: [...targetSession.messages, optimisticUser] });
    try {
      const done = await streamChat("/api/chat/stream", { message: trimmed, sessionId, attachments, toolsEnabled, memoryEnabled, providerModelRef: providerModelRef || undefined }, {
        onToken: (token) => setStreamText((current) => current + token),
        onTimeline: (event) => setTimeline((current) => [...current, event]),
      });
      const resolvedSessionId = done.session?.id ?? sessionId;
      await refreshSessions();
      if (resolvedSessionId) await openSession(resolvedSessionId);
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      setStreaming(false);
      setStreamText("");
    }
  }

  async function retryLast(): Promise<void> {
    if (!activeSession || !await confirmDialog({ title: "Thử lại tin nhắn", description: "Thử lại tin nhắn gần nhất của bạn?", confirmLabel: "Thử lại" })) return;
    const retry = await prepareRetry();
    if (!retry) return;
    setActiveSession(retry);
    if (retry.retryMessage) setMessage(retry.retryMessage);
  }

  async function prepareRetry(messageId?: number): Promise<ChatSessionMessagesSummary | undefined> {
    if (!activeSession) return undefined;
    return runRequest(() => fetchJson<ChatSessionMessagesSummary>("/api/chat/retry", { method: "POST", body: JSON.stringify({ sessionId: activeSession.session.id, messageId, confirm: true }) }), { success: "Đã chuẩn bị thử lại." });
  }

  async function retryMessage(messageId: number): Promise<void> {
    if (!activeSession || !await confirmDialog({ title: "Thử lại từ đây", description: `Thử lại tin nhắn #${messageId}? Các tin nhắn phía sau trong nhánh này có thể bị cắt.`, confirmLabel: "Thử lại" })) return;
    const retry = await prepareRetry(messageId);
    if (!retry) return;
    setActiveSession(retry);
    if (retry.retryMessage) setMessage(retry.retryMessage);
  }

  async function forkAt(messageId: number): Promise<void> {
    if (!activeSession || !await confirmDialog({ title: "Tạo nhánh trò chuyện", description: `Tạo nhánh từ tin nhắn #${messageId}?`, confirmLabel: "Tạo nhánh" })) return;
    const fork = await runRequest(() => fetchJson<ChatSessionMessagesSummary>("/api/chat/fork", { method: "POST", body: JSON.stringify({ sessionId: activeSession.session.id, messageId, confirm: true }) }), { globalLoading: true, success: "Đã tạo nhánh trò chuyện." });
    if (!fork) return;
    setActiveSession(fork);
    await refreshSessions();
  }

  async function copyMessage(content: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
      setActionMessage("Đã sao chép tin nhắn.");
    } catch {
      setActionError("Không thể sao chép tin nhắn.");
    }
  }

  async function addAttachmentFiles(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    const next = await Promise.all(Array.from(files).map(readAttachmentFile));
    setAttachments((current) => [...current, ...next]);
  }

  const attachmentsByMessageId = useMemo(() => buildAttachmentsByMessageId(activeSession?.runs ?? []), [activeSession?.runs]);
  const visibleMessages = useMemo<ChatMessageWithAttachments[]>(() => (activeSession?.messages ?? []).map((item) => ({ ...item, attachments: readMessageAttachments(item) ?? attachmentsByMessageId.get(item.id) })), [activeSession?.messages, attachmentsByMessageId]);
  const visibleEvents = activeSession?.events ?? [];

  if (!data) {
    return <Alert className="border-accent/40 bg-accent/10"><MessageSquareText className="size-4" /><AlertTitle>Đang tải trò chuyện</AlertTitle><AlertDescription>Đang tải các cuộc trò chuyện gần đây.</AlertDescription></Alert>;
  }

  return (
    <div className="grid gap-3" data-chat-panel>
      {actionError ? <ToastEffect title="Không thể cập nhật trò chuyện" description={actionError} tone="error" onShown={() => setActionError(null)} /> : null}
      {actionMessage ? <ToastEffect title="Trò chuyện đã cập nhật" description={actionMessage} tone="success" onShown={() => setActionMessage(null)} /> : null}

      <div className="hidden flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-background/35 p-3 xl:flex" data-chat-summary>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{data.sessions.length} phiên</Badge>
          <Badge variant="outline">{visibleMessages.length} tin nhắn</Badge>
          <Badge variant={visibleEvents.length || timeline.length ? "secondary" : "outline"}>{visibleEvents.length + timeline.length} sự kiện</Badge>
          {activeSession?.session.pinnedAt ? <Badge variant="secondary">đã ghim</Badge> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Tải lại</Button>
          <Button size="sm" onClick={() => void createSession()}><Plus /> Trò chuyện mới</Button>
        </div>
      </div>

      <div className="grid gap-3 xl:h-[calc(100vh-4.5rem)] xl:min-h-[38rem] xl:grid-cols-[var(--chat-session-rail)_minmax(0,1fr)_var(--chat-control-rail)]" style={{ "--chat-session-rail": sessionsCollapsed ? "4.25rem" : "18rem", "--chat-control-rail": controlsCollapsed ? "4.25rem" : "20rem" } as CSSProperties}>
        <Card className="hidden min-h-[18rem] flex-col overflow-hidden border-white/10 bg-background/35 xl:flex xl:min-h-0">
          <CardHeader className="border-b border-white/10 p-4">
            <div className={`flex items-center gap-2 ${sessionsCollapsed ? "justify-center" : "justify-between"}`}>
              {sessionsCollapsed ? null : <div><CardTitle className="flex items-center gap-2 text-base"><MessageSquareText className="size-4" /> Phiêns</CardTitle><CardDescription>Tìm kiếm và chuyển giữa các cuộc trò chuyện.</CardDescription></div>}
              <Button type="button" variant="outline" size="icon" aria-label={sessionsCollapsed ? "Mở rộng danh sách" : "Thu gọn danh sách"} onClick={() => setSessionsCollapsed((current) => !current)}>{sessionsCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</Button>
            </div>
          </CardHeader>
          {sessionsCollapsed ? <CardContent className="flex flex-1 flex-col items-center gap-3 p-3"><MessageSquareText className="size-5 text-muted-foreground" /><Badge variant="outline">{data.sessions.length}</Badge></CardContent> : <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            <form className="grid gap-2" onSubmit={(event) => void searchSessions(event)}>
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm cuộc trò chuyện" id="chat-session-search" />
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Select value={filter} onChange={(event) => setFilter(event.target.value as ChatFilter)}>
                  <option value="all">Tất cả</option><option value="approval">Cần duyệt</option><option value="cancelled">Đã huỷ</option><option value="error">Lỗi</option><option value="fork">Nhánh</option><option value="retry">Thử lại</option>
                </Select>
                <Button type="submit" variant="outline" disabled={loading} size="icon" aria-label="Tìm cuộc trò chuyện"><Search /></Button>
              </div>
            </form>
            <div className="no-scrollbar grid min-h-0 flex-1 content-start gap-2 overflow-auto pr-1" id="chat-session-list">
              {sortedSessions.length ? sortedSessions.map((session) => <SessionRow key={session.id} session={session} active={activeSession?.session.id === session.id} onOpen={openSession} />) : <EmptyText>Chưa có cuộc trò chuyện.</EmptyText>}
            </div>
          </CardContent>}
        </Card>

        <Card className={`flex h-[calc(100dvh-1.5rem)] min-h-0 flex-col overflow-hidden border-white/10 bg-background/35 xl:h-auto xl:min-h-0 ${chatFullscreen ? "fixed inset-3 z-50 bg-background/95 shadow-2xl backdrop-blur-xl md:inset-6" : ""}`} data-chat-fullscreen={chatFullscreen ? "true" : "false"}>
          <CardHeader className="relative z-10 shrink-0 border-b border-white/10 bg-background/80 p-3 backdrop-blur md:p-4">
            <div className="mb-3 flex items-center justify-between gap-2 xl:hidden" data-chat-mobile-toolbar>
              <Button type="button" size="sm" variant="outline" onClick={() => setMobileSheet("sessions")}><MessageSquareText /> Lịch sử <Badge variant="secondary">{data.sessions.length}</Badge></Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setMobileSheet("controls")}><Settings2 /> Tuỳ chọn</Button>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {editingTitle && activeSession ? <div className="flex max-w-xl items-center gap-2"><Input className="h-8" value={draftTitle} autoFocus onChange={(event) => setDraftTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveTitle(); if (event.key === "Escape") setEditingTitle(false); }} aria-label="Sửa tên cuộc trò chuyện" /><Button size="icon" variant="outline" type="button" aria-label="Lưu tên cuộc trò chuyện" onClick={() => void saveTitle()}><Check /></Button><Button size="icon" variant="ghost" type="button" aria-label="Huỷ sửa tên cuộc trò chuyện" onClick={() => setEditingTitle(false)}><X /></Button></div> : <CardTitle className="flex min-w-0 items-center gap-2 text-lg"><span className="truncate">{activeSession ? activeSession.session.title : "Chưa chọn cuộc trò chuyện"}</span>{activeSession ? <Button className="size-7 shrink-0" size="icon" variant="ghost" type="button" aria-label="Sửa tên cuộc trò chuyện" onClick={startEditingTitle}><Pencil className="size-3.5" /></Button> : null}</CardTitle>}
                <CardDescription>{activeSession ? `#${activeSession.session.id} / cập nhật ${formatDate(activeSession.session.updatedAt)}` : "Tạo hoặc mở một cuộc trò chuyện để bắt đầu."}</CardDescription>
              </div>
              <details className="relative">
                <summary className="list-none rounded-full border border-white/10 p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Tác vụ trò chuyện"><MoreHorizontal className="size-4" /></summary>
                <div className="absolute right-0 z-30 mt-2 grid min-w-40 gap-1 rounded-2xl border border-white/10 bg-card p-1 shadow-xl">
                  <button className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs hover:bg-secondary" type="button" onClick={() => setChatFullscreen((current) => !current)} data-chat-header-action="fullscreen">{chatFullscreen ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}{chatFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}</button>
                  <button className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs hover:bg-secondary disabled:opacity-50" type="button" disabled={!activeSession} onClick={() => activeSession && void updateSession({ pinned: !activeSession.session.pinnedAt }, activeSession.session.pinnedAt ? "Đã bỏ ghim cuộc trò chuyện." : "Đã ghim cuộc trò chuyện.")} data-chat-header-action="pin"><Pin className="size-3" />{activeSession?.session.pinnedAt ? "Bỏ ghim" : "Ghim"}</button>
                  <button className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs hover:bg-secondary disabled:opacity-50" type="button" disabled={!activeSession} onClick={() => void retryLast()} data-chat-header-action="retry"><RotateCcw className="size-3" />Thử lại</button>
                </div>
              </details>
            </div>
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-2 sm:p-3 md:p-4">
            <div ref={transcriptRef} className="chat-transcript no-scrollbar grid min-h-0 flex-1 content-start gap-3 overflow-auto rounded-2xl border border-white/10 bg-background/25 p-3 sm:p-4" id="chat-transcript">
              {visibleMessages.length ? visibleMessages.map((item) => <MessageBubble key={item.id} message={item} onCopy={copyMessage} onFork={forkAt} onRetry={retryMessage} />) : <EmptyText>Chưa có tin nhắn trong cuộc trò chuyện này.</EmptyText>}
              {streaming ? <div className="chat-message rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm assistant"><div className="mb-2 flex items-center gap-2 font-semibold"><Loader2 className="size-4 animate-spin" /> Bestie đang trả lời</div><p className="whitespace-pre-wrap text-muted-foreground">{streamText || "Đang suy nghĩ..."}</p></div> : null}
            </div>

            <form className="grid gap-2 rounded-2xl border border-white/10 bg-card/50 p-2.5 sm:p-3" onSubmit={(event) => void sendMessage(event)}>
              {attachments.length ? <div className="flex flex-wrap gap-2">{attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-background/50 px-3 py-1 text-xs"><FileText className="size-3" />{attachment.name}<button type="button" aria-label={`Gỡ ${attachment.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X className="size-3" /></button></span>)}</div> : null}
              <Textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={handleComposerKeyDown} rows={3} placeholder={`Gửi tin nhắn cho ${agentName}`} id="chat-input" className="min-h-20 resize-none border-white/10 bg-background/50 sm:min-h-24" />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border border-white/10 px-2 py-1">Công cụ {toolsEnabled ? "bật" : "tắt"}</span>
                  <span className="rounded-full border border-white/10 px-2 py-1">Bộ nhớ {memoryEnabled ? "bật" : "tắt"}</span>
                  {providerModelRef ? <span className="rounded-full border border-white/10 px-2 py-1">{providerModelRef}</span> : null}
                </div>
                <div className="flex gap-2">
                  <Button asChild type="button" variant="outline"><label className="cursor-pointer"><Paperclip /> Đính kèm<input className="sr-only" type="file" multiple onChange={(event) => void addAttachmentFiles(event.target.files)} /></label></Button>
                  <Button type="submit" disabled={streaming || !message.trim()} id="chat-send"><Send /> Gửi</Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        <aside className="hidden min-h-0 flex-col gap-3 xl:flex">
          <Card className="flex min-h-0 shrink-0 flex-col overflow-hidden border-white/10 bg-background/35">
            <CardHeader className="p-4">
              <div className={`flex items-center gap-2 ${controlsCollapsed ? "justify-center" : "justify-between"}`}>
                {controlsCollapsed ? null : <div><CardTitle className="flex items-center gap-2 text-base"><Settings2 className="size-4" /> Tuỳ chọn</CardTitle><CardDescription>Tuỳ chọn chạy cho cuộc trò chuyện này.</CardDescription></div>}
                <Button type="button" variant="outline" size="icon" aria-label={controlsCollapsed ? "Mở rộng tuỳ chọn" : "Thu gọn tuỳ chọn"} onClick={() => setControlsCollapsed((current) => !current)}>{controlsCollapsed ? <PanelRightOpen /> : <PanelRightClose />}</Button>
              </div>
            </CardHeader>
            {controlsCollapsed ? <CardContent className="flex flex-1 flex-col items-center gap-3 p-3 pt-0"><Settings2 className="size-5 text-muted-foreground" /><Badge variant={visibleEvents.length || timeline.length ? "secondary" : "outline"}>{visibleEvents.length + timeline.length}</Badge></CardContent> : <CardContent className="no-scrollbar grid max-h-[18rem] gap-3 overflow-auto p-4 pt-0">
              <label className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-card/50 p-3 text-sm"><span>Công cụ</span><input type="checkbox" checked={toolsEnabled} onChange={(event) => setToolsEnabled(event.target.checked)} /></label>
              <label className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-card/50 p-3 text-sm"><span>Bộ nhớ</span><input type="checkbox" checked={memoryEnabled} onChange={(event) => setMemoryEnabled(event.target.checked)} /></label>
              <div className="grid gap-1"><Label htmlFor="chat-provider-model">Model AI</Label><Select id="chat-provider-model" value={providerModelRef} onChange={(event) => setProviderModelRef(event.target.value)}><option value="">Tốt nhất hiện có</option>{providerModels.map((model) => <option key={model.modelRef} value={model.modelRef}>{model.modelRef}{model.primary ? " · chính" : model.fallback ? " · dự phòng" : ""}</option>)}</Select></div>
              <Button variant="outline" disabled={!activeSession} onClick={() => void deleteSession()}><Trash2 /> Xoá cuộc trò chuyện</Button>
            </CardContent>}
          </Card>

          {controlsCollapsed ? null : <Card className="flex min-h-0 flex-1 flex-col border-white/10 bg-background/35" id="chat-inspector">
            <CardHeader className="p-4"><CardTitle className="flex items-center gap-2 text-base"><Settings2 className="size-4" /> Theo dõi</CardTitle><CardDescription>Sự kiện mới nhất.</CardDescription></CardHeader>
            <CardContent className="no-scrollbar grid min-h-0 flex-1 content-start gap-2 overflow-auto p-4 pt-0">{[...timeline.map(toTransientEvent), ...visibleEvents].length ? [...timeline.map(toTransientEvent), ...visibleEvents].slice(-8).reverse().map((event) => <EventRow key={`${event.id}-${event.createdAt}`} event={event} />) : <EmptyText>Chưa có sự kiện.</EmptyText>}</CardContent>
          </Card>}
        </aside>
      </div>
      {mobileSheet ? <div className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm xl:hidden" role="dialog" aria-modal="true" aria-label={mobileSheet === "sessions" ? "Lịch sử trò chuyện" : "Tuỳ chọn trò chuyện"} onClick={() => setMobileSheet(null)}>
        <section className="absolute inset-x-0 bottom-0 max-h-[78dvh] rounded-t-[1.75rem] border border-white/10 bg-card p-4 shadow-2xl" onClick={(event) => event.stopPropagation()} data-chat-mobile-sheet={mobileSheet}>
          <div className="mb-4 flex items-center justify-between"><div><p className="font-semibold">{mobileSheet === "sessions" ? "Lịch sử trò chuyện" : "Tuỳ chọn trò chuyện"}</p><p className="text-xs text-muted-foreground">{mobileSheet === "sessions" ? "Mở hoặc tìm cuộc trò chuyện." : "Điều chỉnh cho phiên hiện tại."}</p></div><Button type="button" size="icon" variant="ghost" aria-label="Đóng bảng" onClick={() => setMobileSheet(null)}><X /></Button></div>
          {mobileSheet === "sessions" ? <div className="grid max-h-[62dvh] gap-3 overflow-auto"><div className="flex gap-2"><Button size="sm" onClick={() => void createSession()}><Plus /> Chat mới</Button><Button size="sm" variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Tải lại</Button></div><form className="grid grid-cols-[1fr_auto] gap-2" onSubmit={(event) => void searchSessions(event)}><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm cuộc trò chuyện" /><Button type="submit" size="icon" variant="outline" aria-label="Tìm cuộc trò chuyện"><Search /></Button></form><div className="grid gap-2">{sortedSessions.map((session) => <SessionRow key={session.id} session={session} active={activeSession?.session.id === session.id} onOpen={async (id) => { await openSession(id); setMobileSheet(null); }} />)}</div></div> : <div className="grid gap-3"><label className="flex items-center justify-between rounded-xl border border-white/10 p-3 text-sm"><span>Công cụ</span><input type="checkbox" checked={toolsEnabled} onChange={(event) => setToolsEnabled(event.target.checked)} /></label><label className="flex items-center justify-between rounded-xl border border-white/10 p-3 text-sm"><span>Bộ nhớ</span><input type="checkbox" checked={memoryEnabled} onChange={(event) => setMemoryEnabled(event.target.checked)} /></label><div className="grid gap-2"><Label htmlFor="chat-mobile-provider-model">Model AI</Label><Select id="chat-mobile-provider-model" value={providerModelRef} onChange={(event) => setProviderModelRef(event.target.value)}><option value="">Tốt nhất hiện có</option>{providerModels.map((model) => <option key={model.modelRef} value={model.modelRef}>{model.modelRef}{model.primary ? " · chính" : ""}</option>)}</Select></div>{activeSession ? <Button variant="outline" onClick={() => void deleteSession()}><Trash2 /> Xoá cuộc trò chuyện</Button> : null}</div>}
        </section>
      </div> : null}
    </div>
  );
}

export function ChatPanelError({ error }: { error: unknown }): ReactElement {
  return <ChatError message={formatError(error)} />;
}

async function streamChat(path: string, body: Record<string, unknown>, handlers: { onToken: (token: string) => void; onTimeline: (event: ChatTimelineEvent) => void }): Promise<ChatStreamDoneResult> {
  const response = await fetch(path, { method: "POST", headers: { accept: "text/event-stream", "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok || !response.body) throw new Error(`Không nhận được phản hồi: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneResult: ChatStreamDoneResult | undefined;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const event = parseSseEvent(part);
      if (!event) continue;
      if (event.event === "token" && typeof event.data.token === "string") handlers.onToken(event.data.token);
      if (event.event === "timeline") handlers.onTimeline(event.data as unknown as ChatTimelineEvent);
      if (event.event === "error") throw new Error(typeof event.data.error === "string" ? event.data.error : "Lỗi khi nhận phản hồi.");
      if (event.event === "done") doneResult = event.data as unknown as ChatStreamDoneResult;
    }
  }
  if (!doneResult) throw new Error("Luồng phản hồi đã kết thúc nhưng chưa báo hoàn tất.");
  return doneResult;
}

function parseSseEvent(block: string): { event: string; data: Record<string, unknown> } | undefined {
  const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
  const dataLines = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
  if (!dataLines.length) return undefined;
  return { event, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> };
}

function SessionRow({ session, active, onOpen }: { session: ChatSession; active: boolean; onOpen: (id: number) => Promise<void> }): ReactElement {
  return <button type="button" className={`rounded-2xl border p-3 text-left text-sm transition hover:border-primary/50 ${active ? "border-primary/50 bg-primary/10" : "border-white/10 bg-card/60"}`} onClick={() => void onOpen(session.id)} data-chat-session={session.id}><div className="flex items-start justify-between gap-2"><strong>{session.title}</strong>{session.pinnedAt ? <Badge variant="secondary">đã ghim</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">#{session.id} / {formatDate(session.updatedAt)}</p></button>;
}

function MessageBubble({ message, onCopy, onFork, onRetry }: { message: ChatMessageWithAttachments; onCopy: (content: string) => Promise<void>; onFork: (messageId: number) => Promise<void>; onRetry: (messageId: number) => Promise<void> }): ReactElement {
  const isUser = message.role === "user";
  return (
    <div className={`chat-message max-w-[min(44rem,86%)] rounded-2xl border p-4 text-sm ${isUser ? "ml-auto border-accent/30 bg-accent/10 user" : "mr-auto border-white/10 bg-card/70 assistant"}`} data-chat-message={message.id}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-semibold">{isUser ? <User className="size-4" /> : <Bot className="size-4" />}{isUser ? "Bạn" : "Bestie"}</span>
        <details className="relative">
          <summary className="list-none rounded-full border border-white/10 p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Tác vụ tin nhắn"><MoreHorizontal className="size-4" /></summary>
          <div className="absolute right-0 z-20 mt-2 grid min-w-32 gap-1 rounded-2xl border border-white/10 bg-card p-1 shadow-xl">
            <button className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs hover:bg-secondary" type="button" onClick={() => void onFork(message.id)} data-chat-action="fork"><GitFork className="size-3" /> Tạo nhánh</button>
            <button className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs hover:bg-secondary" type="button" onClick={() => void onCopy(message.content)} data-chat-action="copy"><Copy className="size-3" /> Sao chép</button>
            {isUser ? <button className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs hover:bg-secondary" type="button" onClick={() => void onRetry(message.id)} data-chat-action="retry"><RotateCcw className="size-3" /> Thử lại</button> : null}
          </div>
        </details>
      </div>
      <div className="prose-chat text-muted-foreground">{renderMarkdown(message.content)}</div>
      {message.attachments?.length ? <MessageAttachments attachments={message.attachments} /> : null}
      <p className="mt-2 text-xs text-muted-foreground">{formatDate(message.createdAt)}</p>
    </div>
  );
}

function MessageAttachments({ attachments }: { attachments: ChatAttachment[] }): ReactElement {
  return <div className="mt-3 grid gap-2" data-chat-message-attachments>{attachments.map((attachment, index) => <MessageAttachment key={`${attachment.name}-${index}`} attachment={attachment} />)}</div>;
}

function MessageAttachment({ attachment }: { attachment: ChatAttachment }): ReactElement {
  const isImage = typeof attachment.content === "string" && attachment.content.startsWith("data:image/");
  const isDownloadable = typeof attachment.content === "string" && attachment.content.startsWith("data:");
  const preview = !isImage && attachment.content && attachment.content !== "[đã ẩn dữ liệu ảnh]" ? attachment.content.slice(0, 240) : "";
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-background/45 p-3 text-xs" data-chat-attachment={attachment.name}>
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground"><FileText className="size-3.5" /><strong className="max-w-full truncate text-foreground">{attachment.name}</strong>{attachment.type ? <Badge variant="outline">{attachment.type}</Badge> : null}{attachment.size !== undefined ? <span>{formatBytes(attachment.size)}</span> : null}{isDownloadable ? <a className="rounded-full border border-white/10 px-2 py-0.5 text-foreground hover:bg-secondary" href={attachment.content} download={attachment.name}>Tải xuống</a> : null}</div>
      {isImage ? <img className="mt-2 max-h-48 rounded-xl border border-white/10 object-contain" src={attachment.content} alt={attachment.name} /> : null}
      {preview ? <pre className="no-scrollbar mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-xl bg-background/70 p-2 text-muted-foreground">{preview}</pre> : null}
    </div>
  );
}

interface ChatMessageWithAttachments extends ChatMessage {
  attachments?: ChatAttachment[];
}

function EventRow({ event }: { event: ChatEvent }): ReactElement {
  return <div className="rounded-xl border border-white/10 bg-card/60 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{formatChatEventType(event.eventType)}</strong><Badge variant="outline">{formatDate(event.createdAt)}</Badge></div><p className="mt-1 text-muted-foreground">{event.message}</p></div>;
}

function toTransientEvent(event: ChatTimelineEvent, index: number): ChatEvent {
  return { id: -index - 1, sessionId: 0, eventType: event.type, message: event.label, payloadJson: event.payload === undefined ? undefined : JSON.stringify(event.payload), createdAt: new Date().toISOString() };
}

function ChatError({ message }: { message: string }): ReactElement {
  return <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Không tải được trò chuyện</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>;
}

function EmptyText({ children }: { children: string }): ReactElement {
  return <p className="rounded-2xl border border-dashed border-white/10 bg-background/25 p-4 text-sm text-muted-foreground">{children}</p>;
}

function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function visibleMessageKey(messages: ChatMessage[]): string {
  return messages.map((message) => `${message.id}:${message.content.length}`).join("|");
}

function renderMarkdown(content: string): ReactNode {
  const nodes: ReactNode[] = [];
  const lines = content.split("\n");
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let codeLines: string[] | undefined;

  function flushParagraph(): void {
    if (!paragraph.length) return;
    const text = paragraph.join("\n");
    nodes.push(<p key={nodes.length} className="my-2 whitespace-pre-wrap leading-relaxed">{renderInlineMarkdown(text)}</p>);
    paragraph = [];
  }

  function flushList(): void {
    if (!listItems.length) return;
    nodes.push(<ul key={nodes.length} className="my-2 list-disc space-y-1 pl-5">{listItems.map((item, index) => <li key={index}>{renderInlineMarkdown(item)}</li>)}</ul>);
    listItems = [];
  }

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (codeLines) {
        nodes.push(<pre key={nodes.length} className="no-scrollbar my-2 overflow-auto rounded-xl border border-white/10 bg-background/60 p-3 text-xs text-foreground"><code>{codeLines.join("\n")}</code></pre>);
        codeLines = undefined;
      } else {
        flushParagraph();
        flushList();
        codeLines = [];
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const listMatch = line.trim().match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      listItems.push(listMatch[1]);
      continue;
    }
    flushList();
    if (line.startsWith("### ")) nodes.push(<h3 key={nodes.length} className="my-2 font-semibold text-foreground">{renderInlineMarkdown(line.slice(4))}</h3>);
    else if (line.startsWith("## ")) nodes.push(<h2 key={nodes.length} className="my-2 text-base font-semibold text-foreground">{renderInlineMarkdown(line.slice(3))}</h2>);
    else if (line.startsWith("# ")) nodes.push(<h1 key={nodes.length} className="my-2 text-lg font-semibold text-foreground">{renderInlineMarkdown(line.slice(2))}</h1>);
    else paragraph.push(line);
  }

  if (codeLines) nodes.push(<pre key={nodes.length} className="no-scrollbar my-2 overflow-auto rounded-xl border border-white/10 bg-background/60 p-3 text-xs text-foreground"><code>{codeLines.join("\n")}</code></pre>);
  flushParagraph();
  flushList();
  return nodes;
}

function renderInlineMarkdown(content: string): ReactNode[] {
  const parts = content.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-background/70 px-1 py-0.5 text-foreground">{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    return <span key={index}>{part}</span>;
  });
}

function buildAttachmentsByMessageId(runs: ChatRun[]): Map<number, ChatAttachment[]> {
  const map = new Map<number, ChatAttachment[]>();
  for (const run of runs) {
    if (typeof run.userMessageId !== "number") continue;
    const attachments = readRunAttachments(run);
    if (attachments.length) map.set(run.userMessageId, attachments);
  }
  return map;
}

function readRunAttachments(run: ChatRun): ChatAttachment[] {
  if (!run.metadataJson) return [];
  try {
    const metadata = JSON.parse(run.metadataJson) as { attachments?: unknown };
    return normalizeChatAttachments(metadata.attachments);
  } catch {
    return [];
  }
}

function readMessageAttachments(message: ChatMessage): ChatAttachment[] | undefined {
  const value = (message as { attachments?: unknown }).attachments;
  const attachments = normalizeChatAttachments(value);
  return attachments.length ? attachments : undefined;
}

function normalizeChatAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isChatAttachment).slice(0, 5);
}

function isChatAttachment(value: unknown): value is ChatAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Record<string, unknown>;
  return typeof attachment.name === "string" && typeof attachment.content === "string" && (attachment.type === undefined || typeof attachment.type === "string") && (attachment.size === undefined || typeof attachment.size === "number");
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function readAttachmentFile(file: File): Promise<ChatAttachmentDraft> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Không thể đọc tệp đính kèm ${file.name}.`));
    reader.onload = () => resolve({ name: file.name, type: file.type || undefined, size: file.size, content: String(reader.result ?? "") });
    if (file.type.startsWith("text/") || file.name.endsWith(".md") || file.name.endsWith(".json")) reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

function readStoredBoolean(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeStoredBoolean(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    return;
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatChatEventType(type: string): string {
  const labels: Record<string, string> = {
    thinking: "Đang suy nghĩ",
    tool_start: "Bắt đầu dùng công cụ",
    tool_finish: "Dùng công cụ xong",
    token: "Đang trả lời",
    approval_required: "Cần phê duyệt",
    memory_capture: "Ghi nhớ",
    done: "Hoàn tất",
    error: "Lỗi",
  };
  return labels[type] ?? type;
}
