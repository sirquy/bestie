import type { ReactElement } from "react";
import { AlertTriangle, CheckCircle2, HeartPulse, RefreshCw, ShieldAlert, Wrench } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { fetchJson, formatError } from "@/lib/api";
import { confirmDialog } from "@/lib/dialogs";
import type { DoctorCheck, DoctorFix, DoctorStatus, DoctorSummary } from "./types";

interface DoctorPanelProps {
  data?: DoctorSummary;
  loading: boolean;
  onData: (data: DoctorSummary) => void;
  onLoading: (loading: boolean) => void;
}

export function DoctorPanel({ data, loading, onData, onLoading }: DoctorPanelProps): ReactElement {
  async function reload(): Promise<void> {
    onLoading(true);
    try {
      onData(await fetchJson<DoctorSummary>("/api/doctor"));
    } finally {
      onLoading(false);
    }
  }

  async function runSafeFixes(): Promise<void> {
    if (!await confirmDialog("Run safe fixes for common setup issues? Secrets will stay hidden.")) return;
    onLoading(true);
    try {
      onData(await fetchJson<DoctorSummary>("/api/doctor/fix", { method: "POST", body: JSON.stringify({ confirm: true }) }));
    } finally {
      onLoading(false);
    }
  }

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10">
        <HeartPulse className="size-4" />
        <AlertTitle>Doctor is warming up</AlertTitle>
        <AlertDescription>Checking Bestie's setup and connected features.</AlertDescription>
      </Alert>
    );
  }

  const actionableChecks = data.report.checks.filter((check) => check.fix);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <DoctorMetric label="Status" value={data.ok ? "Healthy" : "Needs care"} tone={data.ok ? "pass" : "fail"} />
        <DoctorMetric label="Pass" value={String(data.summary.pass)} tone="pass" />
        <DoctorMetric label="Warn" value={String(data.summary.warn)} tone="warn" />
        <DoctorMetric label="Fail" value={String(data.summary.fail)} tone="fail" />
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><HeartPulse className="size-5" /> Health checks</CardTitle>
            <CardDescription>A friendly health check for setup, memory, channels, and fixes.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void reload()} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin" : ""} />
              Refresh
            </Button>
            <Button onClick={() => void runSafeFixes()} disabled={loading || actionableChecks.length === 0}>
              <Wrench />
              Fix common issues
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {data.report.checks.map((check) => <DoctorCheckRow key={`${check.name}-${check.status}`} check={check} />)}
        </CardContent>
      </Card>

      {data.report.fixes.length > 0 ? (
        <Card className="border-white/10 bg-background/35">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Wrench className="size-5" /> Fixes applied</CardTitle>
            <CardDescription>Results from the latest confirmation-gated Doctor fix run.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {data.report.fixes.map((fix) => <DoctorFixRow key={`${fix.name}-${fix.status}`} fix={fix} />)}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function DoctorPanelError({ error }: { error: unknown }): ReactElement {
  return (
    <Alert variant="destructive">
      <ShieldAlert className="size-4" />
      <AlertTitle>Doctor request failed</AlertTitle>
      <AlertDescription>{formatError(error)}</AlertDescription>
    </Alert>
  );
}

function DoctorMetric({ label, value, tone }: { label: string; value: string; tone: DoctorStatus }): ReactElement {
  return (
    <Card className="border-white/10 bg-background/35">
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <p className={tone === "pass" ? "mt-2 text-2xl font-semibold text-primary" : tone === "warn" ? "mt-2 text-2xl font-semibold text-accent" : "mt-2 text-2xl font-semibold text-destructive"}>{value}</p>
      </CardContent>
    </Card>
  );
}

function DoctorCheckRow({ check }: { check: DoctorCheck }): ReactElement {
  const Icon = check.status === "pass" ? CheckCircle2 : check.status === "warn" ? AlertTriangle : ShieldAlert;
  return (
    <div className="rounded-2xl border border-white/10 bg-card/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <Icon className={check.status === "pass" ? "mt-0.5 size-5 text-primary" : check.status === "warn" ? "mt-0.5 size-5 text-accent" : "mt-0.5 size-5 text-destructive"} />
          <div>
            <p className="font-semibold">{check.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{check.message}</p>
          </div>
        </div>
        <StatusBadge status={check.status} />
      </div>
      {check.fix ? (
        <>
          <Separator className="my-3" />
          <p className="text-sm"><span className="text-muted-foreground">Suggested fix:</span> {check.fix}</p>
        </>
      ) : null}
    </div>
  );
}

function DoctorFixRow({ fix }: { fix: DoctorFix }): ReactElement {
  const variant = fix.status === "failed" ? "destructive" : fix.status === "fixed" ? "secondary" : "outline";
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-white/10 bg-card/60 p-4">
      <div>
        <p className="font-semibold">{fix.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">{fix.message}</p>
      </div>
      <Badge variant={variant}>{fix.status}</Badge>
    </div>
  );
}

function StatusBadge({ status }: { status: DoctorStatus }): ReactElement {
  if (status === "fail") return <Badge variant="destructive">fail</Badge>;
  if (status === "warn") return <Badge className="border-accent/50 bg-accent/15 text-accent" variant="outline">warn</Badge>;
  return <Badge variant="secondary">pass</Badge>;
}
