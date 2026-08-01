import type { FormEvent, ReactElement } from "react";
import { useEffect, useState } from "react";
import { AlertCircle, Brain, FolderOpen, RefreshCw, Save, Settings, SlidersHorizontal, Sparkles } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { fetchJson, formatError } from "@/lib/api";
import { confirmDialog } from "@/lib/dialogs";
import type { MemoryWritePolicy, SettingsSummary } from "./types";

interface SettingsPanelProps {
  data?: SettingsSummary;
  loading: boolean;
  onData: (data: SettingsSummary) => void;
  onLoading: (loading: boolean) => void;
  onStatusRefresh?: () => void;
}

interface SettingsDraft {
  name: string;
  ownerName: string;
  language: string;
  toneIntensity: number;
  writePolicy: MemoryWritePolicy;
}

export function SettingsPanel({ data, loading, onData, onLoading, onStatusRefresh }: SettingsPanelProps): ReactElement {
  const [draft, setDraft] = useState<SettingsDraft>(() => emptyDraft());
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setDraft({
      name: data.agent.name,
      ownerName: data.agent.ownerName,
      language: data.agent.language,
      toneIntensity: data.agent.toneIntensity,
      writePolicy: data.memory.writePolicy,
    });
  }, [data]);

  async function runAction(action: () => Promise<SettingsSummary>, success?: string): Promise<void> {
    setActionError(null);
    setSaveMessage(null);
    onLoading(true);
    try {
      const nextData = await action();
      onData(nextData);
      onStatusRefresh?.();
      if (success) setSaveMessage(success);
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      onLoading(false);
    }
  }

  async function reload(): Promise<void> {
    await runAction(() => fetchJson<SettingsSummary>("/api/settings"));
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!await confirmDialog(`Save settings for ${draft.name || "Bestie"}?`)) return;
    await runAction(() => fetchJson<SettingsSummary>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        agent: {
          name: draft.name,
          ownerName: draft.ownerName,
          language: draft.language,
          toneIntensity: draft.toneIntensity,
        },
        memory: {
          writePolicy: draft.writePolicy,
        },
        confirm: true,
      }),
    }), "Settings saved.");
  }

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10">
        <Settings className="size-4" />
        <AlertTitle>Settings are loading</AlertTitle>
        <AlertDescription>Reading low-risk config fields from the local runtime API.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      {actionError ? <SettingsError message={actionError} /> : null}
      {saveMessage ? <Alert className="border-primary/40 bg-primary/10"><Sparkles className="size-4" /><AlertTitle>Saved</AlertTitle><AlertDescription>{saveMessage}</AlertDescription></Alert> : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <Card className="border-white/10 bg-background/35">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Settings className="size-5" /> Settings</CardTitle>
              <CardDescription>Low-risk agent and memory policy edits backed by `PUT /api/settings`.</CardDescription>
            </div>
            <Button variant="outline" onClick={() => void reload()} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin" : ""} />
              Reload
            </Button>
          </CardHeader>
          <CardContent>
            <form id="settings-form" className="grid gap-4" onSubmit={(event) => void save(event)}>
              <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Name"><Input name="name" value={draft.name} onChange={(event) => setDraftValue(setDraft, "name", event.target.value)} /></FormField>
                <FormField label="Owner"><Input name="ownerName" value={draft.ownerName} onChange={(event) => setDraftValue(setDraft, "ownerName", event.target.value)} /></FormField>
                <FormField label="Language"><Input name="language" value={draft.language} onChange={(event) => setDraftValue(setDraft, "language", event.target.value)} /></FormField>
                <FormField label="Memory policy">
                  <Select name="writePolicy" value={draft.writePolicy} onChange={(event) => setDraftValue(setDraft, "writePolicy", event.target.value as MemoryWritePolicy)}>
                    <option value="ask">ask</option>
                    <option value="allow">allow</option>
                    <option value="deny">deny</option>
                  </Select>
                </FormField>
              </div>

              <div className="rounded-2xl border border-white/10 bg-card/60 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><SlidersHorizontal className="size-4" /><Label>Tone intensity</Label></div>
                  <Badge variant="outline">{draft.toneIntensity}</Badge>
                </div>
                <Input name="toneIntensity" type="range" min={0} max={10} value={draft.toneIntensity} onChange={(event) => setDraftValue(setDraft, "toneIntensity", Number(event.target.value))} />
              </div>

              <Button className="w-fit" type="submit" disabled={loading || !draft.name.trim() || !draft.ownerName.trim() || !draft.language.trim()}>
                <Save />
                Save settings
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <SettingsSummaryCard title="Agent" icon={<Settings className="size-5" />} rows={[
            ["Name", data.agent.name],
            ["Owner", data.agent.ownerName],
            ["Language", data.agent.language],
            ["Time zone", data.agent.timeZone ?? "-"],
          ]} />
          <SettingsSummaryCard title="Memory" icon={<Brain className="size-5" />} rows={[
            ["Write policy", data.memory.writePolicy],
          ]} />
          <SettingsSummaryCard title="Workspace" icon={<FolderOpen className="size-5" />} rows={[
            ["Default path", data.workspace.defaultPath ?? "-"],
            ["External paths", String(data.workspace.externalPathCount)],
          ]} />
        </div>
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader>
          <CardTitle>LLM routing summary</CardTitle>
          <CardDescription>Read-only here; use Provider Hub for model setup and fallbacks.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <MiniMetric label="Primary" value={data.llm.primary} />
          <MiniMetric label="Auth profile" value={data.llm.authProfile} />
          <MiniMetric label="Fallbacks" value={String(data.llm.fallbackCount)} />
          <MiniMetric label="Profiles" value={String(data.llm.profileCount)} />
          <MiniMetric label="Models" value={String(data.llm.modelCount)} />
        </CardContent>
      </Card>
    </div>
  );
}

export function SettingsPanelError({ error }: { error: unknown }): ReactElement {
  return <SettingsError message={formatError(error)} />;
}

function SettingsError({ message }: { message: string }): ReactElement {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertTitle>Settings request failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function SettingsSummaryCard({ title, icon, rows }: { title: string; icon: ReactElement; rows: Array<[string, string]> }): ReactElement {
  return (
    <Card className="border-white/10 bg-background/35">
      <CardHeader><CardTitle className="flex items-center gap-2">{icon} {title}</CardTitle></CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {rows.map(([label, value]) => <SummaryRow key={label} label={label} value={value} />)}
      </CardContent>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="grid gap-1">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="break-words font-medium">{value || "-"}</p>
      <Separator />
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="rounded-2xl border border-white/10 bg-card/60 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 break-words font-semibold">{value || "-"}</p>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return <div className="grid gap-2"><Label>{label}</Label>{children}</div>;
}

function emptyDraft(): SettingsDraft {
  return { name: "", ownerName: "", language: "vi", toneIntensity: 7, writePolicy: "ask" };
}

function setDraftValue<Key extends keyof SettingsDraft>(setDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void, key: Key, value: SettingsDraft[Key]): void {
  setDraft((current) => ({ ...current, [key]: value }));
}
