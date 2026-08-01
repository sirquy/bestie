import type { ReactElement } from "react";
import { useState } from "react";
import { AlertCircle, Check, ClipboardCheck, Database, RefreshCw, ShieldCheck, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { fetchJson, formatError } from "@/lib/api";
import { confirmDialog } from "@/lib/dialogs";
import type { ApprovalActionResult, ApprovalDecision, ApprovalsSummary, PendingActionApproval } from "./types";

interface ApprovalsPanelProps {
  data?: ApprovalsSummary;
  loading: boolean;
  onData: (data: ApprovalsSummary) => void;
  onLoading: (loading: boolean) => void;
}

export function ApprovalsPanel({ data, loading, onData, onLoading }: ApprovalsPanelProps): ReactElement {
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function runAction(action: () => Promise<ApprovalsSummary>, success?: string): Promise<void> {
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
    await runAction(() => fetchJson<ApprovalsSummary>("/api/approvals"));
  }

  async function decide(decision: ApprovalDecision, approval: PendingActionApproval): Promise<void> {
    const verb = decision === "approve" ? "Approve" : "Deny";
    if (!await confirmDialog(`${verb} ${approval.action} #${approval.id}?`)) return;
    await runAction(async () => {
      const result = await fetchJson<ApprovalActionResult>("/api/approvals/action", { method: "POST", body: JSON.stringify({ action: decision, id: approval.id, confirm: true }) });
      const executionMessage = result.execution ? ` Execution: ${result.execution.message ?? result.execution.error ?? (result.execution.ok ? "ok" : "failed")}` : "";
      setActionMessage(`${verb}d approval #${approval.id}.${executionMessage}`);
      return result;
    });
  }

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10">
        <ClipboardCheck className="size-4" />
        <AlertTitle>Approvals are loading</AlertTitle>
        <AlertDescription>Reading pending action approvals from local memory storage.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      {actionError ? <ApprovalsError message={actionError} /> : null}
      {actionMessage ? <Alert className="border-primary/40 bg-primary/10"><Check className="size-4" /><AlertTitle>Approval updated</AlertTitle><AlertDescription>{actionMessage}</AlertDescription></Alert> : null}

      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Pending" value={String(data.count)} tone={data.count ? "warn" : "good"} />
        <Metric label="Database" value={data.databaseExists ? "ready" : "missing"} tone={data.databaseExists ? "good" : "warn"} />
        <Metric label="Review mode" value="confirm gated" tone="good" />
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" /> Pending approvals</CardTitle>
            <CardDescription>External, destructive, public, or sensitive actions wait here for explicit review.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={data.databaseExists ? "secondary" : "destructive"}><Database className="mr-1 size-3" /> {data.databaseExists ? "database ready" : "database missing"}</Badge>
            <Button variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Reload</Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {data.approvals.length ? data.approvals.map((approval) => <ApprovalRow key={approval.id} approval={approval} loading={loading} onDecision={decide} />) : <EmptyApprovals />}
        </CardContent>
      </Card>
    </div>
  );
}

export function ApprovalsPanelError({ error }: { error: unknown }): ReactElement {
  return <ApprovalsError message={formatError(error)} />;
}

function ApprovalsError({ message }: { message: string }): ReactElement {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertTitle>Approvals request failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function ApprovalRow({ approval, loading, onDecision }: { approval: PendingActionApproval; loading: boolean; onDecision: (decision: ApprovalDecision, approval: PendingActionApproval) => Promise<void> }): ReactElement {
  return (
    <div className="approval-row rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{approval.action}</p>
            <Badge variant="outline">#{approval.id}</Badge>
            <Badge variant={approval.channel === "ui" || approval.channel === "ui-chat" ? "secondary" : "outline"}>{approval.channel}</Badge>
            <Badge variant="outline">{approval.category}</Badge>
          </div>
          <p className="mt-2 text-muted-foreground">{approval.target || "No target"}</p>
          <p className="mt-1 text-muted-foreground">{approval.reason || approval.proposedReason || "No reason provided"}</p>
        </div>
        <div className="flex gap-2">
          <Button data-approval-action="approve" size="sm" onClick={() => void onDecision("approve", approval)} disabled={loading}><Check /> Approve</Button>
          <Button data-approval-action="deny" size="sm" variant="outline" onClick={() => void onDecision("deny", approval)} disabled={loading}><X /> Deny</Button>
        </div>
      </div>
      <Separator className="my-3" />
      <div className="grid gap-1 text-xs text-muted-foreground md:grid-cols-3">
        <p>Status: {approval.status}</p>
        <p>Created: {formatDate(approval.createdAt)}</p>
        <p>Expires: {formatDate(approval.expiresAt)}</p>
      </div>
      {approval.userId ? <p className="mt-2 text-xs text-muted-foreground">User: {approval.userId}</p> : null}
    </div>
  );
}

function EmptyApprovals(): ReactElement {
  return <p className="rounded-2xl border border-dashed border-white/10 bg-background/25 p-4 text-sm text-muted-foreground">No pending approvals. Bestie is behaving herself. Suspicious, but we take the win.</p>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" }): ReactElement {
  return (
    <Card className="border-white/10 bg-background/35">
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <p className={tone === "good" ? "mt-2 text-2xl font-semibold text-primary" : "mt-2 text-2xl font-semibold text-accent"}>{value}</p>
      </CardContent>
    </Card>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

