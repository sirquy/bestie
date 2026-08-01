import type { FormEvent, ReactElement } from "react";
import { useMemo, useState } from "react";
import { AlertCircle, Bot, Download, GitFork, Loader2, MessageSquareText, Pin, Plus, RefreshCw, RotateCcw, Search, Send, Settings2, Trash2, Upload, User } from "lucide-react";

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
import type { ChatEvent, ChatExportSummary, ChatMessage, ChatSession, ChatSessionMessagesSummary, ChatSessionsSummary, ChatStreamDoneResult, ChatTimelineEvent } from "./types";

interface ChatPanelProps {
  data?: ChatSessionsSummary;
  loading: boolean;
  onData: (data: ChatSessionsSummary) => void;
  onLoading: (loading: boolean) => void;
}

type ChatFilter = "all" | "approval" | "cancelled" | "error" | "fork" | "retry";

export function ChatPanel({ data, loading, onData, onLoading }: ChatPanelProps): ReactElement {
  const [activeSession, setActiveSession] = useState<ChatSessionMessagesSummary | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [message, setMessage] = useState("");
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [providerModelRef, setProviderModelRef] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [timeline, setTimeline] = useState<ChatTimelineEvent[]>([]);
  const [importText, setImportText] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const sessions = data?.sessions ?? [];
  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt)) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [sessions]);

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
    const title = window.prompt("New chat title", "New chat") ?? undefined;
    const result = await runRequest(() => fetchJson<ChatSessionMessagesSummary>("/api/chat/sessions", { method: "POST", body: JSON.stringify({ title }) }), { globalLoading: true, success: "Chat session created." });
    if (!result) return;
    setActiveSession(result);
    await refreshSessions();
  }

  async function updateSession(body: Record<string, unknown>, success: string): Promise<void> {
    if (!activeSession) return;
    const result = await runRequest(() => fetchJson<ChatSessionMessagesSummary>("/api/chat/session", { method: "PUT", body: JSON.stringify({ id: activeSession.session.id, ...body }) }), { success });
    if (!result) return;
    setActiveSession(result);
    await refreshSessions();
  }

  async function deleteSession(): Promise<void> {
    if (!activeSession || !window.confirm(`Delete chat session #${activeSession.session.id}?`)) return;
    await runRequest(() => fetchJson<ChatSessionMessagesSummary>("/api/chat/sessions/delete", { method: "POST", body: JSON.stringify({ id: activeSession.session.id, confirm: true }) }), { globalLoading: true, success: "Chat session deleted." });
    setActiveSession(null);
    await refreshSessions();
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || streaming) return;
    const sessionId = activeSession?.session.id;
    setMessage("");
    setStreamText("");
    setTimeline([]);
    setStreaming(true);
    setActionError(null);
    const optimisticUser: ChatMessage = { id: Date.now(), sessionId: sessionId ?? 0, role: "user", content: trimmed, createdAt: new Date().toISOString() };
    if (activeSession) setActiveSession({ ...activeSession, messages: [...activeSession.messages, optimisticUser] });
    try {
      const done = await streamChat("/api/chat/stream", { message: trimmed, sessionId, toolsEnabled, memoryEnabled, providerModelRef: providerModelRef || undefined }, {
        onToken: (token) => setStreamText((current) => current + token),
        onTimeline: (event) => setTimeline((current) => [...current, event]),
      });
      const resolvedSessionId = done.session?.id ?? sessionId;
      await refreshSessions();
      if (resolvedSessionId) await openSession(resolvedSessionId);
      setActionMessage(`Response completed with ${done.model}.`);
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      setStreaming(false);
      setStreamText("");
    }
  }

  async function retryLast(): Promise<void> {
    if (!activeSession || !window.confirm("Retry last user message?")) return;
    const retry = await runRequest(() => fetchJson<ChatSessionMessagesSummary>("/api/chat/retry", { method: "POST", body: JSON.stringify({ sessionId: activeSession.session.id, confirm: true }) }), { success: "Retry prepared." });
    if (!retry) return;
    setActiveSession(retry);
    if (retry.retryMessage) setMessage(retry.retryMessage);
  }

  async function forkAt(messageId: number): Promise<void> {
    if (!activeSession || !window.confirm(`Fork chat at message #${messageId}?`)) return;
    const fork = await runRequest(() => fetchJson<ChatSessionMessagesSummary>("/api/chat/fork", { method: "POST", body: JSON.stringify({ sessionId: activeSession.session.id, messageId, confirm: true }) }), { globalLoading: true, success: "Chat fork created." });
    if (!fork) return;
    setActiveSession(fork);
    await refreshSessions();
  }

  async function exportSession(): Promise<void> {
    if (!activeSession) return;
    const exported = await runRequest(() => fetchJson<ChatExportSummary>(`/api/chat/export?id=${activeSession.session.id}`), { success: "Chat exported below." });
    if (exported) setImportText(JSON.stringify(exported, null, 2));
  }

  async function importSession(): Promise<void> {
    if (!importText.trim() || !window.confirm("Import chat session from JSON?")) return;
    try {
      const parsed = JSON.parse(importText) as unknown;
      const imported = await runRequest(() => fetchJson<ChatSessionMessagesSummary>("/api/chat/import", { method: "POST", body: JSON.stringify({ export: parsed }) }), { globalLoading: true, success: "Chat imported." });
      if (!imported) return;
      setActiveSession(imported);
      await refreshSessions();
    } catch (error: unknown) {
      setActionError(formatError(error));
    }
  }

  if (!data) {
    return <Alert className="border-accent/40 bg-accent/10"><MessageSquareText className="size-4" /><AlertTitle>Chat is loading</AlertTitle><AlertDescription>Reading local UI chat sessions from SQLite.</AlertDescription></Alert>;
  }

  const visibleMessages = activeSession?.messages ?? [];
  const visibleEvents = activeSession?.events ?? [];

  return (
    <div className="grid gap-4" data-chat-panel>
      {actionError ? <ChatError message={actionError} /> : null}
      {actionMessage ? <Alert className="border-primary/40 bg-primary/10"><Bot className="size-4" /><AlertTitle>Chat update</AlertTitle><AlertDescription>{actionMessage}</AlertDescription></Alert> : null}

      <div className="grid gap-3 md:grid-cols-4" data-chat-summary>
        <Metric label="Sessions" value={String(data.sessions.length)} />
        <Metric label="Pinned" value={String(data.sessions.filter((session) => session.pinnedAt).length)} />
        <Metric label="Messages" value={String(visibleMessages.length)} />
        <Metric label="Events" value={String(visibleEvents.length + timeline.length)} tone={visibleEvents.length || timeline.length ? "warn" : "neutral"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
        <Card className="border-white/10 bg-background/35">
          <CardHeader>
            <div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><MessageSquareText className="size-5" /> Sessions</CardTitle><CardDescription>Search, pin, create, and open local chat sessions.</CardDescription></div><Button size="sm" onClick={() => void createSession()}><Plus /> New</Button></div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <form className="grid gap-2" onSubmit={(event) => void searchSessions(event)}>
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sessions" id="chat-session-search" />
              <div className="grid grid-cols-[1fr_auto] gap-2"><Select value={filter} onChange={(event) => setFilter(event.target.value as ChatFilter)}><option value="all">all</option><option value="approval">approval</option><option value="cancelled">cancelled</option><option value="error">error</option><option value="fork">fork</option><option value="retry">retry</option></Select><Button type="submit" variant="outline" disabled={loading}><Search /> Search</Button></div>
            </form>
            <Button variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Reload</Button>
            <Separator />
            <div className="grid gap-2" id="chat-session-list">
              {sortedSessions.length ? sortedSessions.map((session) => <SessionRow key={session.id} session={session} active={activeSession?.session.id === session.id} onOpen={openSession} />) : <EmptyText>No chat sessions yet.</EmptyText>}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="border-white/10 bg-background/35">
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div><CardTitle>{activeSession ? activeSession.session.title : "No active chat"}</CardTitle><CardDescription>{activeSession ? `Session #${activeSession.session.id} / updated ${formatDate(activeSession.session.updatedAt)}` : "Create or open a session to start chatting."}</CardDescription></div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!activeSession} onClick={() => activeSession && void updateSession({ pinned: !activeSession.session.pinnedAt }, activeSession.session.pinnedAt ? "Session unpinned." : "Session pinned.")}><Pin /> {activeSession?.session.pinnedAt ? "Unpin" : "Pin"}</Button>
                <Button size="sm" variant="outline" disabled={!activeSession} onClick={() => void retryLast()}><RotateCcw /> Retry</Button>
                <Button size="sm" variant="outline" disabled={!activeSession} onClick={() => void exportSession()}><Download /> Export</Button>
                <Button size="sm" variant="outline" disabled={!activeSession} onClick={() => void deleteSession()}><Trash2 /> Delete</Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2 md:grid-cols-3">
                <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-card/50 p-3 text-sm"><input type="checkbox" checked={toolsEnabled} onChange={(event) => setToolsEnabled(event.target.checked)} /> Tools</label>
                <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-card/50 p-3 text-sm"><input type="checkbox" checked={memoryEnabled} onChange={(event) => setMemoryEnabled(event.target.checked)} /> Memory</label>
                <div className="grid gap-1"><Label htmlFor="chat-provider-model">Provider model</Label><Input id="chat-provider-model" value={providerModelRef} onChange={(event) => setProviderModelRef(event.target.value)} placeholder="default" /></div>
              </div>
              <div className="chat-transcript no-scrollbar grid max-h-[44rem] gap-3 overflow-auto rounded-2xl border border-white/10 bg-background/30 p-3" id="chat-transcript">
                {visibleMessages.length ? visibleMessages.map((item) => <MessageBubble key={item.id} message={item} onFork={forkAt} />) : <EmptyText>No messages in this session.</EmptyText>}
                {streaming ? <div className="chat-message rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm assistant"><div className="mb-2 flex items-center gap-2 font-semibold"><Loader2 className="size-4 animate-spin" /> Bestie is replying</div><p className="whitespace-pre-wrap text-muted-foreground">{streamText || "Thinking..."}</p></div> : null}
              </div>
              <form className="grid gap-2" onSubmit={(event) => void sendMessage(event)}>
                <Textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} placeholder="Nhắn Bestie ở đây..." id="chat-input" />
                <div className="flex flex-wrap justify-between gap-2"><p className="text-xs text-muted-foreground">Enter a message; local tools and memory remain permission-gated by backend policy.</p><Button type="submit" disabled={streaming || !message.trim()} id="chat-send"><Send /> Send</Button></div>
              </form>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="border-white/10 bg-background/35" id="chat-inspector"><CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="size-5" /> Inspector</CardTitle><CardDescription>Timeline events, approvals, and run metadata.</CardDescription></CardHeader><CardContent className="grid gap-3">{[...timeline.map(toTransientEvent), ...visibleEvents].length ? [...timeline.map(toTransientEvent), ...visibleEvents].slice(-12).reverse().map((event) => <EventRow key={`${event.id}-${event.createdAt}`} event={event} />) : <EmptyText>No events yet.</EmptyText>}</CardContent></Card>
            <Card className="border-white/10 bg-background/35"><CardHeader><CardTitle className="flex items-center gap-2"><Upload className="size-5" /> Import / Export</CardTitle><CardDescription>Export fills this box; paste exported JSON to import a session.</CardDescription></CardHeader><CardContent className="grid gap-2"><Textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={8} placeholder="Exported chat JSON" /><Button variant="outline" onClick={() => void importSession()} disabled={!importText.trim()}><Upload /> Import JSON</Button></CardContent></Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatPanelError({ error }: { error: unknown }): ReactElement {
  return <ChatError message={formatError(error)} />;
}

async function streamChat(path: string, body: Record<string, unknown>, handlers: { onToken: (token: string) => void; onTimeline: (event: ChatTimelineEvent) => void }): Promise<ChatStreamDoneResult> {
  const response = await fetch(path, { method: "POST", headers: { accept: "text/event-stream", "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok || !response.body) throw new Error(`Chat stream failed: ${response.status}`);
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
      if (event.event === "error") throw new Error(typeof event.data.error === "string" ? event.data.error : "Chat stream error.");
      if (event.event === "done") doneResult = event.data as unknown as ChatStreamDoneResult;
    }
  }
  if (!doneResult) throw new Error("Chat stream ended without a done event.");
  return doneResult;
}

function parseSseEvent(block: string): { event: string; data: Record<string, unknown> } | undefined {
  const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
  const dataLines = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
  if (!dataLines.length) return undefined;
  return { event, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> };
}

function SessionRow({ session, active, onOpen }: { session: ChatSession; active: boolean; onOpen: (id: number) => Promise<void> }): ReactElement {
  return <button type="button" className={`rounded-2xl border p-3 text-left text-sm transition hover:border-primary/50 ${active ? "border-primary/50 bg-primary/10" : "border-white/10 bg-card/60"}`} onClick={() => void onOpen(session.id)} data-chat-session={session.id}><div className="flex items-start justify-between gap-2"><strong>{session.title}</strong>{session.pinnedAt ? <Badge variant="secondary">pinned</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">#{session.id} / {formatDate(session.updatedAt)}</p></button>;
}

function MessageBubble({ message, onFork }: { message: ChatMessage; onFork: (messageId: number) => Promise<void> }): ReactElement {
  const isUser = message.role === "user";
  return <div className={`chat-message rounded-2xl border p-4 text-sm ${isUser ? "ml-auto border-accent/30 bg-accent/10 user" : "mr-auto border-white/10 bg-card/70 assistant"}`} data-chat-message={message.id}><div className="mb-2 flex items-center justify-between gap-3"><span className="flex items-center gap-2 font-semibold">{isUser ? <User className="size-4" /> : <Bot className="size-4" />}{isUser ? "You" : "Bestie"}</span><Button size="sm" variant="outline" onClick={() => void onFork(message.id)} data-chat-action="fork"><GitFork /> Fork</Button></div><p className="whitespace-pre-wrap text-muted-foreground">{message.content}</p><p className="mt-2 text-xs text-muted-foreground">{formatDate(message.createdAt)}</p></div>;
}

function EventRow({ event }: { event: ChatEvent }): ReactElement {
  return <div className="rounded-xl border border-white/10 bg-card/60 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{event.eventType}</strong><Badge variant="outline">{formatDate(event.createdAt)}</Badge></div><p className="mt-1 text-muted-foreground">{event.message}</p></div>;
}

function toTransientEvent(event: ChatTimelineEvent, index: number): ChatEvent {
  return { id: -index - 1, sessionId: 0, eventType: event.type, message: event.label, payloadJson: event.payload === undefined ? undefined : JSON.stringify(event.payload), createdAt: new Date().toISOString() };
}

function ChatError({ message }: { message: string }): ReactElement {
  return <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Chat request failed</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>;
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "warn" | "neutral" }): ReactElement {
  return <Card className="border-white/10 bg-background/35"><CardContent className="p-4"><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className={tone === "warn" ? "mt-2 text-2xl font-semibold text-accent" : "mt-2 text-2xl font-semibold"}>{value}</p></CardContent></Card>;
}

function EmptyText({ children }: { children: string }): ReactElement {
  return <p className="rounded-2xl border border-dashed border-white/10 bg-background/25 p-4 text-sm text-muted-foreground">{children}</p>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
