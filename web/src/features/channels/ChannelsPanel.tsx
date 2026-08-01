import type { FormEvent, ReactElement } from "react";
import { useState } from "react";
import { AlertCircle, Cable, CalendarClock, Check, Play, RefreshCw, Save, Square, Trash2 } from "lucide-react";

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
import type { ChannelActionResult, ChannelSummary, ConfiguredChannel, CronSchedule, CronScheduleType, DaemonChannel } from "./types";

interface ChannelsPanelProps {
  data?: ChannelSummary;
  loading: boolean;
  onData: (data: ChannelSummary) => void;
  onLoading: (loading: boolean) => void;
}

interface CronDraft {
  name: string;
  scheduleType: CronScheduleType;
  scheduleValue: string;
  channel: string;
  prompt: string;
  enabled: boolean;
}

export function ChannelsPanel({ data, loading, onData, onLoading }: ChannelsPanelProps): ReactElement {
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<CronDraft>(() => ({ name: "New schedule", scheduleType: "interval", scheduleValue: "1h", channel: "", prompt: "Send a short update.", enabled: true }));

  async function runAction(action: () => Promise<ChannelActionResult | ChannelSummary>, success?: string): Promise<void> {
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

  async function reload(): Promise<void> {
    await runAction(() => fetchJson<ChannelSummary>("/api/channels"));
  }

  async function daemon(action: "daemon_start" | "daemon_stop" | "daemon_restart", channel: DaemonChannel): Promise<void> {
    const verb = action === "daemon_start" ? "Start" : action === "daemon_stop" ? "Stop" : "Restart";
    if (!await confirmDialog(`${verb} ${channel} background service?`)) return;
    await runAction(() => postChannelAction({ action, channel, confirm: true }));
  }

  async function cronToggle(schedule: CronSchedule): Promise<void> {
    const enabled = !schedule.enabled;
    if (!await confirmDialog(`${enabled ? "Enable" : "Disable"} scheduled message ${schedule.name}?`)) return;
    await runAction(() => postChannelAction({ action: "cron_toggle", id: schedule.id, enabled, confirm: true }));
  }

  async function cronDelete(schedule: CronSchedule): Promise<void> {
    if (!await confirmDialog(`Delete scheduled message ${schedule.name}?`)) return;
    await runAction(() => postChannelAction({ action: "cron_delete", id: schedule.id, confirm: true }));
  }

  async function cronTrigger(schedule: CronSchedule): Promise<void> {
    if (!await confirmDialog(`Trigger scheduled message ${schedule.name} now?`)) return;
    await runAction(() => postChannelAction({ action: "cron_trigger", id: schedule.id, confirm: true }));
  }

  async function cronCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!await confirmDialog(`Create scheduled message ${draft.name}?`)) return;
    await runAction(() => postChannelAction({ action: "cron_add", name: draft.name, scheduleType: draft.scheduleType, scheduleValue: draft.scheduleValue, prompt: draft.prompt, channel: draft.channel.trim() || undefined, enabled: draft.enabled, confirm: true }), "Scheduled message saved.");
  }

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10"><Cable className="size-4" /><AlertTitle>Channels are loading</AlertTitle><AlertDescription>Loading connected channels and scheduled messages.</AlertDescription></Alert>
    );
  }

  return (
    <div className="grid gap-4">
      {actionError ? <ChannelError message={actionError} /> : null}
      {actionMessage ? <Alert className="border-primary/40 bg-primary/10"><Check className="size-4" /><AlertTitle>Channel updated</AlertTitle><AlertDescription>{actionMessage}</AlertDescription></Alert> : null}

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Channels" value={String(data.channels.length)} />
        <Metric label="Cron enabled" value={String(data.cron.counts.enabled)} tone="good" />
        <Metric label="Cron disabled" value={String(data.cron.counts.disabled)} tone={data.cron.counts.disabled ? "warn" : "neutral"} />
        <Metric label="Service" value={data.service.supported ? "supported" : "manual"} />
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div><CardTitle className="flex items-center gap-2"><Cable className="size-5" /> Channels</CardTitle><CardDescription>Manage Telegram, Zalo, and background delivery.</CardDescription></div>
          <Button variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Reload</Button>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {data.channels.map((channel) => <ChannelCard key={channel.id} channel={channel} loading={loading} onDaemon={daemon} />)}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="border-white/10 bg-background/35">
          <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-5" /> Add cron</CardTitle><CardDescription>Create a local scheduled message. Actions stay confirmation-gated.</CardDescription></CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={(event) => void cronCreate(event)}>
              <FormField label="Name"><Input value={draft.name} onChange={(event) => setDraftValue(setDraft, "name", event.target.value)} /></FormField>
              <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Type"><Select value={draft.scheduleType} onChange={(event) => setDraftValue(setDraft, "scheduleType", event.target.value as CronScheduleType)}><option value="interval">interval</option><option value="cron_expr">cron_expr</option><option value="once">once</option></Select></FormField>
                <FormField label="Schedule"><Input value={draft.scheduleValue} onChange={(event) => setDraftValue(setDraft, "scheduleValue", event.target.value)} /></FormField>
              </div>
              <FormField label="Channel target"><Input value={draft.channel} onChange={(event) => setDraftValue(setDraft, "channel", event.target.value)} placeholder="telegram:111" /></FormField>
              <FormField label="Prompt"><Textarea value={draft.prompt} onChange={(event) => setDraftValue(setDraft, "prompt", event.target.value)} /></FormField>
              <label className="flex items-center gap-2 text-sm text-muted-foreground"><input checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} type="checkbox" /> Enabled</label>
              <Button className="w-fit" type="submit" disabled={loading || !draft.name.trim() || !draft.scheduleValue.trim() || !draft.prompt.trim()}><Save /> Create schedule</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-background/35">
          <CardHeader><CardTitle>Scheduled messages</CardTitle><CardDescription>{data.cron.databaseExists ? "Ready" : "Not ready"}</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            {data.cron.schedules.length ? data.cron.schedules.map((schedule) => <CronScheduleCard key={schedule.id} schedule={schedule} loading={loading} onToggle={cronToggle} onDelete={cronDelete} onTrigger={cronTrigger} />) : <p className="rounded-2xl border border-dashed border-white/10 bg-background/25 p-4 text-sm text-muted-foreground">No scheduled messages yet.</p>}
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader><CardTitle>Schedule history</CardTitle><CardDescription>Recent scheduled message results.</CardDescription></CardHeader>
        <CardContent className="grid gap-3">
          {data.cron.logs.length ? data.cron.logs.map((log) => <CronLogRow key={log.id} log={log} />) : <p className="text-sm text-muted-foreground">No schedule history yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

export function ChannelsPanelError({ error }: { error: unknown }): ReactElement {
  return <ChannelError message={formatError(error)} />;
}

async function postChannelAction(body: Record<string, unknown>): Promise<ChannelActionResult> {
  return fetchJson<ChannelActionResult>("/api/channels/action", { method: "POST", body: JSON.stringify(body) });
}

function ChannelCard({ channel, loading, onDaemon }: { channel: ConfiguredChannel; loading: boolean; onDaemon: (action: "daemon_start" | "daemon_stop" | "daemon_restart", channel: DaemonChannel) => Promise<void> }): ReactElement {
  const daemonChannel = channel.id as DaemonChannel;
  return (
    <div className="rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-lg font-semibold">{channel.displayName}</p><p className="text-muted-foreground">{channel.id}</p></div><Badge variant={channel.enabled ? "secondary" : "outline"}>{channel.enabled ? "enabled" : "disabled"}</Badge></div>
      <Separator className="my-3" />
      <div className="grid gap-2"><StatusLine label="Owner" value={channel.ownerConfigured ? "ready" : "not set"} /><StatusLine label="Secret" value={channel.secretPresent ? "ready" : channel.tokenEnv ? "missing" : "not required"} /><StatusLine label="Background service" value={channel.daemon.pid ? `${channel.daemon.state}` : channel.daemon.state} /></div>
      <div className="mt-3 flex flex-wrap gap-2" data-channel-action={channel.id}><Button size="sm" onClick={() => void onDaemon("daemon_start", daemonChannel)} disabled={loading}><Play /> Start</Button><Button size="sm" variant="outline" onClick={() => void onDaemon("daemon_stop", daemonChannel)} disabled={loading}><Square /> Stop</Button><Button size="sm" variant="secondary" onClick={() => void onDaemon("daemon_restart", daemonChannel)} disabled={loading}><RefreshCw /> Restart</Button></div>
    </div>
  );
}

function CronScheduleCard({ schedule, loading, onToggle, onDelete, onTrigger }: { schedule: CronSchedule; loading: boolean; onToggle: (schedule: CronSchedule) => Promise<void>; onDelete: (schedule: CronSchedule) => Promise<void>; onTrigger: (schedule: CronSchedule) => Promise<void> }): ReactElement {
  return (
    <div className="rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{schedule.name}</p><p className="text-muted-foreground">{schedule.scheduleType} / {schedule.scheduleValue}</p></div><Badge variant={schedule.enabled ? "secondary" : "destructive"}>{schedule.enabled ? "enabled" : "disabled"}</Badge></div>
      <p className="mt-2 text-muted-foreground">{schedule.prompt}</p>
      <Separator className="my-3" />
      <div className="grid gap-1 text-xs text-muted-foreground"><p>Next: {formatDate(schedule.nextRunAt)}</p><p>Runs: {schedule.runCount}</p>{schedule.channel ? <p>Channel: {schedule.channel}</p> : null}{schedule.lastResult ? <p>Last: {schedule.lastResult}</p> : null}</div>
      <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void onTrigger(schedule)} disabled={loading}><Play /> Trigger</Button><Button size="sm" variant="secondary" onClick={() => void onToggle(schedule)} disabled={loading}>{schedule.enabled ? "Disable" : "Enable"}</Button><Button size="sm" variant="outline" onClick={() => void onDelete(schedule)} disabled={loading}><Trash2 /> Delete</Button></div>
    </div>
  );
}

function CronLogRow({ log }: { log: { id: number; scheduleId: number; startedAt: string; finishedAt?: string; result?: string; output?: string; error?: string } }): ReactElement {
  const detail = log.error || log.output || log.finishedAt || "in progress";
  return <div className="rounded-2xl border border-white/10 bg-card/60 p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">Log #{log.id}</p><Badge variant={log.error ? "destructive" : "secondary"}>{log.result ?? (log.error ? "error" : "running")}</Badge></div><p className="mt-1 text-muted-foreground">schedule {log.scheduleId} / started {formatDate(log.startedAt)}</p><p className="mt-2">{detail}</p></div>;
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "warn" | "neutral" }): ReactElement {
  const className = tone === "good" ? "text-primary" : tone === "warn" ? "text-accent" : "text-foreground";
  return <Card className="border-white/10 bg-background/35"><CardContent className="p-4"><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className={`mt-2 text-2xl font-semibold ${className}`}>{value}</p></CardContent></Card>;
}

function StatusLine({ label, value }: { label: string; value: string }): ReactElement {
  return <p><span className="text-muted-foreground">{label}:</span> {value}</p>;
}

function FormField({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return <div className="grid gap-2"><Label>{label}</Label>{children}</div>;
}

function ChannelError({ message }: { message: string }): ReactElement {
  return <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Channel request failed</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>;
}

function setDraftValue<Key extends keyof CronDraft>(setDraft: (updater: (current: CronDraft) => CronDraft) => void, key: Key, value: CronDraft[Key]): void {
  setDraft((current) => ({ ...current, [key]: value }));
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
