import type { ReactElement } from "react";
import { useState } from "react";
import { AlertCircle, FolderOpen, RefreshCw, ShieldCheck, SlidersHorizontal, TerminalSquare } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { fetchJson, formatError } from "@/lib/api";
import type { ToolPolicy, ToolPolicyEntry, ToolsSummary } from "./types";

interface ToolsPanelProps {
  data?: ToolsSummary;
  loading: boolean;
  onData: (data: ToolsSummary) => void;
  onLoading: (loading: boolean) => void;
}

export function ToolsPanel({ data, loading, onData, onLoading }: ToolsPanelProps): ReactElement {
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function runAction(action: () => Promise<ToolsSummary>, success?: string): Promise<void> {
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
    await runAction(() => fetchJson<ToolsSummary>("/api/tools"));
  }

  async function updatePolicy(tool: string, policy: ToolPolicy): Promise<void> {
    await runAction(() => fetchJson<ToolsSummary>("/api/tools/policy", { method: "PUT", body: JSON.stringify({ tool, policy }) }), "Action rule updated.");
  }

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10">
        <ShieldCheck className="size-4" />
        <AlertTitle>Tools are loading</AlertTitle>
        <AlertDescription>Loading what Bestie can access and do.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      {actionError ? <ToolsError message={actionError} /> : null}
      {actionMessage ? <Alert className="border-primary/40 bg-primary/10"><ShieldCheck className="size-4" /><AlertTitle>Policy updated</AlertTitle><AlertDescription>{actionMessage}</AlertDescription></Alert> : null}

      <div className="grid gap-3 md:grid-cols-4" data-tools-summary>
        <Metric label="Allow" value={String(data.policies.allow)} tone="good" />
        <Metric label="Ask" value={String(data.policies.ask)} tone="warn" />
        <Metric label="Deny" value={String(data.policies.deny)} tone="bad" />
        <Metric label="Action timeout" value={data.exec.timeoutMs === undefined ? "default" : `${data.exec.timeoutMs}ms`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.85fr]">
        <Card className="border-white/10 bg-background/35">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><SlidersHorizontal className="size-5" /> Allowed actions</CardTitle>
              <CardDescription>Keep defaults conservative; public, destructive, and external actions should stay approval-gated.</CardDescription>
            </div>
            <Button variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Reload</Button>
          </CardHeader>
          <CardContent className="grid gap-3">
            {data.policies.entries.length ? data.policies.entries.map((entry) => <ToolPolicyRow key={entry.tool} entry={entry} loading={loading} onUpdate={updatePolicy} />) : <p className="rounded-2xl border border-dashed border-white/10 bg-background/25 p-4 text-sm text-muted-foreground">No custom action rules yet.</p>}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="border-white/10 bg-background/35">
            <CardHeader><CardTitle className="flex items-center gap-2"><FolderOpen className="size-5" /> Folders</CardTitle><CardDescription>Folders Bestie can read or write when actions are allowed.</CardDescription></CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <SummaryRow label="Main folder" value={data.workspace.defaultPath ?? "-"} />
              <SummaryRow label="Extra folders" value={String(data.workspace.externalPathCount)} />
              <Separator />
              {data.workspace.externalPaths.length ? data.workspace.externalPaths.map((path) => <p key={path} className="break-all rounded-xl border border-white/10 bg-card/60 p-3 text-muted-foreground">{path}</p>) : <p className="text-muted-foreground">No extra folders added yet.</p>}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-background/35">
            <CardHeader><CardTitle className="flex items-center gap-2"><TerminalSquare className="size-5" /> Command safety</CardTitle><CardDescription>Limits for actions that run commands.</CardDescription></CardHeader>
            <CardContent><SummaryRow label="Timeout" value={data.exec.timeoutMs === undefined ? "default" : `${data.exec.timeoutMs}ms`} /></CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function ToolsPanelError({ error }: { error: unknown }): ReactElement {
  return <ToolsError message={formatError(error)} />;
}

function ToolsError({ message }: { message: string }): ReactElement {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertTitle>Tools request failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function ToolPolicyRow({ entry, loading, onUpdate }: { entry: ToolPolicyEntry; loading: boolean; onUpdate: (tool: string, policy: ToolPolicy) => Promise<void> }): ReactElement {
  return (
    <div className="rounded-2xl border border-white/10 bg-card/60 p-4 text-sm" data-tool-policy={entry.tool}>
      <div className="grid gap-3 md:grid-cols-[1fr_12rem] md:items-center">
        <div>
          <p className="font-semibold">{entry.tool}</p>
          <p className="mt-1 text-muted-foreground">Internal tool execution policy</p>
        </div>
        <Select data-tool-policy-select={entry.tool} value={entry.policy} disabled={loading} onChange={(event) => void onUpdate(entry.tool, event.target.value as ToolPolicy)}>
          <option value="allow">allow</option>
          <option value="ask">ask</option>
          <option value="deny">deny</option>
        </Select>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "warn" | "bad" | "neutral" }): ReactElement {
  const className = tone === "good" ? "text-primary" : tone === "warn" ? "text-accent" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <Card className="border-white/10 bg-background/35">
      <CardContent className="p-4"><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className={`mt-2 text-2xl font-semibold ${className}`}>{value}</p></CardContent>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): ReactElement {
  return <div><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className="mt-1 break-words font-medium">{value}</p></div>;
}
