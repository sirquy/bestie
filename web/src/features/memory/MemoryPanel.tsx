import type { FormEvent, ReactElement } from "react";
import { useState } from "react";
import { AlertCircle, Brain, Check, Clock, Database, RefreshCw, Search, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { fetchJson, formatError } from "@/lib/api";
import { confirmDialog } from "@/lib/dialogs";
import { ToastEffect } from "@/lib/toasts";
import type { ConversationSummaryItem, MemoryAction, MemoryItem, MemorySummary, PendingMemoryItem } from "./types";

interface MemoryPanelProps {
  data?: MemorySummary;
  loading: boolean;
  onData: (data: MemorySummary) => void;
  onLoading: (loading: boolean) => void;
}

export function MemoryPanel({ data, loading, onData, onLoading }: MemoryPanelProps): ReactElement {
  const [query, setQuery] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function runAction(action: () => Promise<MemorySummary>, success?: string): Promise<void> {
    setActionError(null);
    setActionMessage(null);
    onLoading(true);
    try {
      onData(await action());
      if (success) setActionMessage(success);
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      onLoading(false);
    }
  }

  async function reload(): Promise<void> {
    setQuery("");
    await runAction(() => fetchJson<MemorySummary>("/api/memory"));
  }

  async function search(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = query.trim();
    await runAction(() => fetchJson<MemorySummary>(trimmed ? `/api/memory/search?q=${encodeURIComponent(trimmed)}` : "/api/memory"));
  }

  async function updatePending(action: MemoryAction, id: number): Promise<void> {
    const verb = action === "approve_pending" ? "Duyệt" : "Từ chối";
    if (!await confirmDialog(`${verb} bộ nhớ đang chờ #${id}?`)) return;
    await runAction(() => fetchJson<MemorySummary>("/api/memory/action", { method: "POST", body: JSON.stringify({ action, id, confirm: true }) }), `Đã cập nhật bộ nhớ đang chờ #${id}.`);
  }

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10">
        <Brain className="size-4" />
        <AlertTitle>Đang tải bộ nhớ</AlertTitle>
        <AlertDescription>Đang tải bộ nhớ và mục cần duyệt.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      {actionError ? <ToastEffect title="Không thể cập nhật bộ nhớ" description={actionError} tone="error" onShown={() => setActionError(null)} /> : null}
      {actionMessage ? <ToastEffect title="Bộ nhớ đã cập nhật" description={actionMessage} tone="success" onShown={() => setActionMessage(null)} /> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <MemoryMetric label="Đang dùng" value={String(data.counts.active)} />
        <MemoryMetric label="Đang chờ" value={String(data.counts.pending)} tone={data.counts.pending ? "warn" : "good"} />
        <MemoryMetric label="Cốt lõi" value={String(data.counts.core)} />
        <MemoryMetric label="Dự án" value={String(data.counts.project)} />
        <MemoryMetric label="Phiên" value={String(data.counts.session)} />
        <MemoryMetric label="Tóm tắt" value={String(data.counts.conversationSummaries)} />
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Database className="size-5" /> Kho bộ nhớ</CardTitle>
            <CardDescription>Được lưu riêng tư trên thiết bị này.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={data.database.exists ? "secondary" : "destructive"}>{data.database.exists ? "sẵn sàng" : "chưa sẵn sàng"}</Badge>
            <Badge variant={data.state.paused ? "destructive" : "outline"}>{data.state.paused ? "đang tạm dừng" : "đang hoạt động"}</Badge>
            <Button variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Tải lại</Button>
          </div>
        </CardHeader>
        <CardContent>
          <form className="grid gap-2 md:grid-cols-[1fr_auto]" onSubmit={(event) => void search(event)}>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm bộ nhớ đang dùng và đang chờ" />
            <Button type="submit" disabled={loading}><Search /> Tìm kiếm</Button>
          </form>
          {data.query ? <p className="mt-3 text-sm text-muted-foreground">Từ khoá tìm kiếm: {data.query}</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card className="border-white/10 bg-background/35">
          <CardHeader><CardTitle>Cần xem xét</CardTitle><CardDescription>Duyệt hoặc từ chối các ghi nhớ được đề xuất trước khi kích hoạt.</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            {data.pending.length ? data.pending.map((item) => <PendingMemoryRow key={item.id} item={item} loading={loading} onAction={updatePending} />) : <EmptyText>Không có bộ nhớ đang chờ.</EmptyText>}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-background/35">
          <CardHeader><CardTitle>Bộ nhớ đang dùng</CardTitle><CardDescription>Những thông tin Bestie có thể dùng trong các cuộc trò chuyện sau.</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            {data.memories.length ? data.memories.map((item) => <MemoryRow key={item.id} item={item} />) : <EmptyText>Không tìm thấy bộ nhớ đang dùng.</EmptyText>}
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader><CardTitle>Ghi chú hội thoại</CardTitle><CardDescription>Ghi chú ngắn giúp Bestie nhớ ngữ cảnh trò chuyện.</CardDescription></CardHeader>
        <CardContent className="grid gap-3">
          {data.conversationSummaries.length ? data.conversationSummaries.map((item) => <ConversationSummaryRow key={item.id} item={item} />) : <EmptyText>Chưa có tóm tắt cuộc trò chuyện.</EmptyText>}
        </CardContent>
      </Card>
    </div>
  );
}

export function MemoryPanelError({ error }: { error: unknown }): ReactElement {
  return <MemoryError message={formatError(error)} />;
}

function MemoryError({ message }: { message: string }): ReactElement {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertTitle>Không tải được bộ nhớ</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function MemoryMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "warn" | "neutral" }): ReactElement {
  return (
    <Card className="border-white/10 bg-background/35">
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <p className={tone === "good" ? "mt-2 text-2xl font-semibold text-primary" : tone === "warn" ? "mt-2 text-2xl font-semibold text-accent" : "mt-2 text-2xl font-semibold"}>{value}</p>
      </CardContent>
    </Card>
  );
}

function MemoryRow({ item }: { item: MemoryItem }): ReactElement {
  return (
    <div className="memory-row rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="font-semibold">{item.type}</p><p className="mt-1 text-muted-foreground">{item.content}</p></div>
        <div className="flex flex-wrap gap-2"><Badge variant={item.pinned ? "secondary" : "outline"}>{item.pinned ? "pinned" : item.scope}</Badge><Badge variant={item.sensitivity === "sensitive" ? "destructive" : "secondary"}>{item.sensitivity}</Badge></div>
      </div>
      <Separator className="my-3" />
      <p className="text-xs text-muted-foreground">mức quan trọng {item.importance} / độ tin cậy {item.confidence} / cập nhật {formatDate(item.updatedAt)}</p>
    </div>
  );
}

function PendingMemoryRow({ item, loading, onAction }: { item: PendingMemoryItem; loading: boolean; onAction: (action: MemoryAction, id: number) => Promise<void> }): ReactElement {
  return (
    <div className="memory-row rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-semibold">Đang chờ {item.type}</p><p className="mt-1 text-muted-foreground">{item.content}</p></div>
        <div className="flex gap-2"><Button size="sm" onClick={() => void onAction("approve_pending", item.id)} disabled={loading}><Check /> Duyệt</Button><Button size="sm" variant="outline" onClick={() => void onAction("reject_pending", item.id)} disabled={loading}><X /> Từ chối</Button></div>
      </div>
      <Separator className="my-3" />
      <p className="text-xs text-muted-foreground">{item.reason || item.source || formatDate(item.createdAt)} / consent {item.explicitConsent ? "yes" : "no"}</p>
    </div>
  );
}

function ConversationSummaryRow({ item }: { item: ConversationSummaryItem }): ReactElement {
  return (
    <div className="memory-row rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-semibold">{item.channel}{item.userId ? ` / ${item.userId}` : ""}</p><Badge variant="secondary">tóm tắt</Badge></div>
      <p className="mt-2 text-muted-foreground">{item.content}</p>
      <Separator className="my-3" />
      <p className="text-xs text-muted-foreground"><Clock className="mr-1 inline size-3" />tin nhắn #{item.summarizedMessageId} / cập nhật {formatDate(item.updatedAt)}</p>
    </div>
  );
}

function EmptyText({ children }: { children: string }): ReactElement {
  return <p className="rounded-2xl border border-dashed border-white/10 bg-background/25 p-4 text-sm text-muted-foreground">{children}</p>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
