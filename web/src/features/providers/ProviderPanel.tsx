import type { FormEvent, ReactElement } from "react";
import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, PlugZap, RefreshCw, Route, Save, Star, TestTube2 } from "lucide-react";

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
import { providerPresets, type ProviderCandidate, type ProviderModel, type ProviderPreset, type ProviderProfile, type ProviderSummary, type ProviderTestResult } from "./types";

interface ProviderPanelProps {
  data?: ProviderSummary;
  loading: boolean;
  onData: (data: ProviderSummary) => void;
  onLoading: (loading: boolean) => void;
}

interface ProviderFormState {
  provider: string;
  mode: string;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  secret: string;
  setDefault: boolean;
}

export function ProviderPanel({ data, loading, onData, onLoading }: ProviderPanelProps): ReactElement {
  const [selectedModelRef, setSelectedModelRef] = useState("");
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderFormState>(() => presetToForm(providerPresets[0]));

  const modelOptions = data?.models ?? [];
  const effectiveSelectedModel = selectedModelRef || data?.primary?.modelRef || modelOptions[0]?.modelRef || "";
  const activePreset = useMemo(() => providerPresets.find((preset) => preset.provider === form.provider) ?? providerPresets[0], [form.provider]);
  const isGemini = form.provider.trim().toLowerCase() === "gemini";
  const isLocal = form.mode === "local" || form.provider.trim().toLowerCase() === "ollama";

  async function runAction(action: () => Promise<ProviderSummary>): Promise<void> {
    setActionError(null);
    onLoading(true);
    try {
      onData(await action());
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      onLoading(false);
    }
  }

  function applyPreset(preset: ProviderPreset): void {
    setForm(presetToForm(preset));
  }

  async function reload(): Promise<void> {
    await runAction(() => fetchJson<ProviderSummary>("/api/providers"));
  }

  async function testProvider(): Promise<void> {
    setActionError(null);
    setTestResult(null);
    onLoading(true);
    try {
      setTestResult(await fetchJson<ProviderTestResult>("/api/providers/test", { method: "POST", body: JSON.stringify({ modelRef: effectiveSelectedModel || undefined }) }));
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      onLoading(false);
    }
  }

  async function setPrimary(): Promise<void> {
    if (!effectiveSelectedModel) return;
    if (!await confirmDialog(`Set ${effectiveSelectedModel} as the primary model?`)) return;
    await runAction(() => fetchJson<ProviderSummary>("/api/providers/primary", { method: "POST", body: JSON.stringify({ modelRef: effectiveSelectedModel }) }));
  }

  async function updateFallback(action: "add" | "remove"): Promise<void> {
    if (!effectiveSelectedModel) return;
    const verb = action === "add" ? "Add" : "Remove";
    if (!await confirmDialog(`${verb} ${effectiveSelectedModel} ${action === "add" ? "to" : "from"} fallbacks?`)) return;
    await runAction(() => fetchJson<ProviderSummary>("/api/providers/fallbacks", { method: "POST", body: JSON.stringify({ action, modelRef: effectiveSelectedModel }) }));
  }

  async function setupProvider(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!await confirmDialog(`Save provider ${form.provider}/${form.model}?`)) return;
    await runAction(() => fetchJson<ProviderSummary>("/api/providers/setup", {
      method: "POST",
      body: JSON.stringify({
        provider: form.provider.trim(),
        mode: form.mode,
        model: form.model.trim(),
        ...(isGemini || !form.baseUrl.trim() ? {} : { baseUrl: form.baseUrl.trim() }),
        ...(isLocal || !form.apiKeyEnv.trim() ? {} : { apiKeyEnv: form.apiKeyEnv.trim() }),
        ...(isLocal || !form.secret ? {} : { secret: form.secret }),
        setDefault: form.setDefault,
      }),
    }));
    setForm((current) => ({ ...current, secret: "" }));
  }

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10">
        <PlugZap className="size-4" />
        <AlertTitle>Provider Hub is loading</AlertTitle>
        <AlertDescription>Reading provider profiles and model catalog from the local runtime API.</AlertDescription>
      </Alert>
    );
  }

  if (!data.ok && data.error) {
    return <ProviderError message={data.error.message} />;
  }

  return (
    <div className="grid gap-4">
      {actionError ? <ProviderError message={actionError} /> : null}
      {testResult ? <ProviderTestNotice result={testResult} /> : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <ProviderCandidateCard title="Primary" candidate={data.primary} featured />
        <Card className="border-white/10 bg-background/35 lg:col-span-2">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Route className="size-5" /> Model routing</CardTitle>
              <CardDescription>Set the primary model, test it, or manage fallback order.</CardDescription>
            </div>
            <Button variant="outline" onClick={() => void reload()} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin" : ""} />
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
              <Select value={effectiveSelectedModel} onChange={(event) => setSelectedModelRef(event.target.value)} disabled={modelOptions.length === 0}>
                {modelOptions.map((model) => <option key={model.modelRef} value={model.modelRef}>{model.modelRef}</option>)}
              </Select>
              <Button onClick={() => void testProvider()} disabled={loading || !effectiveSelectedModel} variant="outline"><TestTube2 /> Test</Button>
              <Button onClick={() => void setPrimary()} disabled={loading || !effectiveSelectedModel}><Star /> Set primary</Button>
              <Button onClick={() => void updateFallback("add")} disabled={loading || !effectiveSelectedModel} variant="secondary">Add fallback</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void updateFallback("remove")} disabled={loading || !effectiveSelectedModel} variant="outline">Remove fallback</Button>
              <Badge variant="outline">{data.models.length} models</Badge>
              <Badge variant="outline">{data.profiles.length} profiles</Badge>
              <Badge variant="outline">{data.fallbacks.length} fallbacks</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card className="border-white/10 bg-background/35">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="size-5" /> Provider setup</CardTitle>
            <CardDescription>{activePreset.note}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-2">
              {providerPresets.map((preset) => <Button key={preset.id} type="button" variant={preset.provider === form.provider ? "secondary" : "outline"} size="sm" onClick={() => applyPreset(preset)}>{preset.label}</Button>)}
            </div>
            <form className="grid gap-3" onSubmit={(event) => void setupProvider(event)}>
              <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Provider"><Input value={form.provider} onChange={(event) => setFormValue(setForm, "provider", event.target.value)} /></FormField>
                <FormField label="Mode"><Select value={form.mode} onChange={(event) => setFormValue(setForm, "mode", event.target.value)}><option value="api-key">api-key</option><option value="local">local</option></Select></FormField>
                <FormField label="Model"><Input value={form.model} onChange={(event) => setFormValue(setForm, "model", event.target.value)} /></FormField>
                {!isGemini ? <FormField label="Base URL"><Input value={form.baseUrl} onChange={(event) => setFormValue(setForm, "baseUrl", event.target.value)} placeholder="https://api.example.com/v1" /></FormField> : null}
                {!isLocal ? <FormField label="API key env"><Input value={form.apiKeyEnv} onChange={(event) => setFormValue(setForm, "apiKeyEnv", event.target.value)} placeholder="GEMINI_API_KEY" /></FormField> : null}
                {!isLocal ? <FormField label="Secret value"><Input value={form.secret} onChange={(event) => setFormValue(setForm, "secret", event.target.value)} type="password" placeholder="Saved to .env, never displayed" /></FormField> : null}
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input checked={form.setDefault} onChange={(event) => setForm((current) => ({ ...current, setDefault: event.target.checked }))} type="checkbox" />
                Set as primary model after saving
              </label>
              <Button className="w-fit" type="submit" disabled={loading}><Save /> Save provider</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-background/35">
          <CardHeader>
            <CardTitle>Fallbacks</CardTitle>
            <CardDescription>Configured fallback candidates, in runtime order.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {data.fallbacks.length ? data.fallbacks.map((candidate) => <ProviderCandidateRow key={candidate.modelRef} candidate={candidate} />) : <p className="text-sm text-muted-foreground">No fallback models configured.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ProviderProfileList profiles={data.profiles} />
        <ProviderModelList models={data.models} />
      </div>
    </div>
  );
}

export function ProviderPanelError({ error }: { error: unknown }): ReactElement {
  return <ProviderError message={formatError(error)} />;
}

function ProviderError({ message }: { message: string }): ReactElement {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertTitle>Provider request failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function ProviderTestNotice({ result }: { result: ProviderTestResult }): ReactElement {
  return (
    <Alert className={result.ok ? "border-primary/40 bg-primary/10" : "border-destructive/40 bg-destructive/10"}>
      {result.ok ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
      <AlertTitle>{result.ok ? "Provider test passed" : "Provider test failed"}</AlertTitle>
      <AlertDescription>{result.message ?? result.modelRef}{result.latencyMs ? ` (${result.latencyMs}ms)` : ""}</AlertDescription>
    </Alert>
  );
}

function ProviderCandidateCard({ title, candidate, featured = false }: { title: string; candidate?: ProviderCandidate; featured?: boolean }): ReactElement {
  return (
    <Card className={featured ? "border-primary/30 bg-primary/10" : "border-white/10 bg-background/35"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PlugZap className="size-5" /> {title}</CardTitle>
        <CardDescription>{candidate?.authProfile ?? "No model configured"}</CardDescription>
      </CardHeader>
      <CardContent>{candidate ? <ProviderCandidateRow candidate={candidate} /> : <p className="text-sm text-muted-foreground">Provider configuration is missing.</p>}</CardContent>
    </Card>
  );
}

function ProviderCandidateRow({ candidate }: { candidate: ProviderCandidate }): ReactElement {
  return (
    <div className="grid gap-2 rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{candidate.modelRef}</p>
          <p className="text-muted-foreground">{candidate.provider} / {candidate.model}</p>
        </div>
        <Badge variant={candidate.secretPresent ? "secondary" : "destructive"}>{candidate.secretPresent ? "ready" : "missing secret"}</Badge>
      </div>
      <Separator />
      <p><span className="text-muted-foreground">Base URL:</span> {candidate.baseUrl}</p>
      {candidate.apiKeyEnv ? <p><span className="text-muted-foreground">API key env:</span> {candidate.apiKeyEnv}</p> : null}
    </div>
  );
}

function ProviderProfileList({ profiles }: { profiles: ProviderProfile[] }): ReactElement {
  return (
    <Card className="border-white/10 bg-background/35">
      <CardHeader><CardTitle>Profiles</CardTitle><CardDescription>Auth profiles and secret presence.</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        {profiles.map((profile) => (
          <div key={profile.id} className="rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-semibold">{profile.id}</p><Badge variant={profile.secretPresent ? "secondary" : "destructive"}>{profile.secretPresent ? "ready" : "secret"}</Badge></div>
            <p className="mt-1 text-muted-foreground">{profile.provider} / {profile.mode}</p>
            <p className="mt-2"><span className="text-muted-foreground">Used by:</span> {profile.usedBy.join(", ") || "-"}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ProviderModelList({ models }: { models: ProviderModel[] }): ReactElement {
  return (
    <Card className="border-white/10 bg-background/35">
      <CardHeader><CardTitle>Model catalog</CardTitle><CardDescription>Configured model refs and routing markers.</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        {models.map((model) => (
          <div key={model.modelRef} className="flex flex-wrap items-start justify-between gap-2 rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
            <div><p className="font-semibold">{model.modelRef}</p><p className="text-muted-foreground">{model.profile}</p></div>
            <div className="flex gap-2">{model.primary ? <Badge>primary</Badge> : null}{model.fallback ? <Badge variant="outline">fallback</Badge> : null}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function FormField({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return <div className="grid gap-2"><Label>{label}</Label>{children}</div>;
}

function presetToForm(preset: ProviderPreset): ProviderFormState {
  return { provider: preset.provider, mode: preset.mode, model: preset.model, baseUrl: preset.baseUrl ?? "", apiKeyEnv: preset.apiKeyEnv ?? "", secret: "", setDefault: false };
}

function setFormValue(setForm: (updater: (current: ProviderFormState) => ProviderFormState) => void, key: keyof ProviderFormState, value: string): void {
  setForm((current) => ({ ...current, [key]: value }));
}
