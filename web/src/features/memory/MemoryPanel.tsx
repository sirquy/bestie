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
    const verb = action === "approve_pending" ? "Approve" : "Reject";
    if (!await confirmDialog(`${verb} pending memory #${id}?`)) return;
    await runAction(() => fetchJson<MemorySummary>("/api/memory/action", { method: "POST", body: JSON.stringify({ action, id, confirm: true }) }), `Pending memory #${id} updated.`);
  }

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10">
        <Brain className="size-4" />
        <AlertTitle>Memory Center is loading</AlertTitle>
        <AlertDescription>Reading local SQLite memory state from the runtime API.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      {actionError ? <MemoryError message={actionError} /> : null}
      {actionMessage ? <Alert className="border-primary/40 bg-primary/10"><Check className="size-4" /><AlertTitle>Updated</AlertTitle><AlertDescription>{actionMessage}</AlertDescription></Alert> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <MemoryMetric label="Active" value={String(data.counts.active)} />
        <MemoryMetric label="Pending" value={String(data.counts.pending)} tone={data.counts.pending ? "warn" : "good"} />
        <MemoryMetric label="Core" value={String(data.counts.core)} />
        <MemoryMetric label="Project" value={String(data.counts.project)} />
        <MemoryMetric label="Session" value={String(data.counts.session)} />
        <MemoryMetric label="Summaries" value={String(data.counts.conversationSummaries)} />
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Database className="size-5" /> Memory database</CardTitle>
            <CardDescription>{data.database.path}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={data.database.exists ? "secondary" : "destructive"}>{data.database.exists ? "exists" : "missing"}</Badge>
            <Badge variant={data.state.paused ? "destructive" : "outline"}>{data.state.paused ? "paused" : "active"}</Badge>
            <Button variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Reload</Button>
          </div>
        </CardHeader>
        <CardContent>
          <form className="grid gap-2 md:grid-cols-[1fr_auto]" onSubmit={(event) => void search(event)}>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search active and pending memories" />
            <Button type="submit" disabled={loading}><Search /> Search</Button>
          </form>
          {data.query ? <p className="mt-3 text-sm text-muted-foreground">Search query: {data.query}</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card className="border-white/10 bg-background/35">
          <CardHeader><CardTitle>Pending approval</CardTitle><CardDescription>Approve or reject proposed memories before they become active.</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            {data.pending.length ? data.pending.map((item) => <PendingMemoryRow key={item.id} item={item} loading={loading} onAction={updatePending} />) : <EmptyText>No pending memories.</EmptyText>}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-background/35">
          <CardHeader><CardTitle>Active memories</CardTitle><CardDescription>Latest active memories from local SQLite.</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            {data.memories.length ? data.memories.map((item) => <MemoryRow key={item.id} item={item} />) : <EmptyText>No active memories found.</EmptyText>}
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader><CardTitle>Conversation summaries</CardTitle><CardDescription>Recent persisted conversation summaries used for recall context.</CardDescription></CardHeader>
        <CardContent className="grid gap-3">
          {data.conversationSummaries.length ? data.conversationSummaries.map((item) => <ConversationSummaryRow key={item.id} item={item} />) : <EmptyText>No conversation summaries yet.</EmptyText>}
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
      <AlertTitle>Memory request failed</AlertTitle>
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
      <p className="text-xs text-muted-foreground">importance {item.importance} / confidence {item.confidence} / updated {formatDate(item.updatedAt)}</p>
    </div>
  );
}

function PendingMemoryRow({ item, loading, onAction }: { item: PendingMemoryItem; loading: boolean; onAction: (action: MemoryAction, id: number) => Promise<void> }): ReactElement {
  return (
    <div className="memory-row rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-semibold">Pending {item.type}</p><p className="mt-1 text-muted-foreground">{item.content}</p></div>
        <div className="flex gap-2"><Button size="sm" onClick={() => void onAction("approve_pending", item.id)} disabled={loading}><Check /> Approve</Button><Button size="sm" variant="outline" onClick={() => void onAction("reject_pending", item.id)} disabled={loading}><X /> Reject</Button></div>
      </div>
      <Separator className="my-3" />
      <p className="text-xs text-muted-foreground">{item.reason || item.source || formatDate(item.createdAt)} / consent {item.explicitConsent ? "yes" : "no"}</p>
    </div>
  );
}

function ConversationSummaryRow({ item }: { item: ConversationSummaryItem }): ReactElement {
  return (
    <div className="memory-row rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-semibold">{item.channel}{item.userId ? ` / ${item.userId}` : ""}</p><Badge variant="secondary">summary</Badge></div>
      <p className="mt-2 text-muted-foreground">{item.content}</p>
      <Separator className="my-3" />
      <p className="text-xs text-muted-foreground"><Clock className="mr-1 inline size-3" />message #{item.summarizedMessageId} / updated {formatDate(item.updatedAt)}</p>
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
