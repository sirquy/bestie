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
import { ToastEffect } from "@/lib/toasts";
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
    if (!await confirmDialog(`Đặt ${effectiveSelectedModel} làm mô hình chính?`)) return;
    await runAction(() => fetchJson<ProviderSummary>("/api/providers/primary", { method: "POST", body: JSON.stringify({ modelRef: effectiveSelectedModel }) }));
  }

  async function updateFallback(action: "add" | "remove"): Promise<void> {
    if (!effectiveSelectedModel) return;
    const verb = action === "add" ? "Thêm" : "Gỡ bỏ";
    if (!await confirmDialog(`${verb} ${effectiveSelectedModel} ${action === "add" ? "vào" : "khỏi"} danh sách dự phòng?`)) return;
    await runAction(() => fetchJson<ProviderSummary>("/api/providers/fallbacks", { method: "POST", body: JSON.stringify({ action, modelRef: effectiveSelectedModel }) }));
  }

  async function setupProvider(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!await confirmDialog(`Lưu kết nối ${form.provider}/${form.model}?`)) return;
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
        <AlertTitle>Đang tải mô hình AI</AlertTitle>
        <AlertDescription>Đang tải lựa chọn model AI đã lưu.</AlertDescription>
      </Alert>
    );
  }

  if (!data.ok && data.error) {
    return <ProviderError message={data.error.message} />;
  }

  return (
    <div className="grid gap-4">
      {actionError ? <ToastEffect title="Không thể cập nhật mô hình AI" description={actionError} tone="error" onShown={() => setActionError(null)} /> : null}
      {testResult ? <ProviderTestNotice result={testResult} onShown={() => setTestResult(null)} /> : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <ProviderCandidateCard title="Mô hình chính" candidate={data.primary} featured />
        <Card className="border-white/10 bg-background/35 lg:col-span-2">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Route className="size-5" /> Lựa chọn mô hình AI</CardTitle>
              <CardDescription>Chọn mô hình AI chính và các phương án dự phòng.</CardDescription>
            </div>
            <Button variant="outline" onClick={() => void reload()} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin" : ""} />
              Tải lại
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
              <Select value={effectiveSelectedModel} onChange={(event) => setSelectedModelRef(event.target.value)} disabled={modelOptions.length === 0}>
                {modelOptions.map((model) => <option key={model.modelRef} value={model.modelRef}>{model.modelRef}</option>)}
              </Select>
              <Button onClick={() => void testProvider()} disabled={loading || !effectiveSelectedModel} variant="outline"><TestTube2 /> Kiểm tra</Button>
              <Button onClick={() => void setPrimary()} disabled={loading || !effectiveSelectedModel}><Star /> Đặt làm chính</Button>
              <Button onClick={() => void updateFallback("add")} disabled={loading || !effectiveSelectedModel} variant="secondary">Thêm dự phòng</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void updateFallback("remove")} disabled={loading || !effectiveSelectedModel} variant="outline">Gỡ dự phòng</Button>
              <Badge variant="outline">{data.models.length} models</Badge>
              <Badge variant="outline">{data.profiles.length} connections</Badge>
              <Badge variant="outline">{data.fallbacks.length} dự phòng</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card className="border-white/10 bg-background/35">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="size-5" /> Thiết lập dịch vụ</CardTitle>
            <CardDescription>{activePreset.note}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-2">
              {providerPresets.map((preset) => <Button key={preset.id} type="button" variant={preset.provider === form.provider ? "secondary" : "outline"} size="sm" onClick={() => applyPreset(preset)}>{preset.label}</Button>)}
            </div>
            <form className="grid gap-3" onSubmit={(event) => void setupProvider(event)}>
              <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Nhà cung cấp"><Input value={form.provider} onChange={(event) => setFormValue(setForm, "provider", event.target.value)} /></FormField>
                <FormField label="Chế độ"><Select value={form.mode} onChange={(event) => setFormValue(setForm, "mode", event.target.value)}><option value="api-key">API key</option><option value="local">Cục bộ</option></Select></FormField>
                <FormField label="Model"><Input value={form.model} onChange={(event) => setFormValue(setForm, "model", event.target.value)} /></FormField>
                {!isGemini ? <FormField label="URL gốc"><Input value={form.baseUrl} onChange={(event) => setFormValue(setForm, "baseUrl", event.target.value)} placeholder="https://api.example.com/v1" /></FormField> : null}
                {!isLocal ? <FormField label="Tên thông tin xác thực"><Input value={form.apiKeyEnv} onChange={(event) => setFormValue(setForm, "apiKeyEnv", event.target.value)} placeholder="GEMINI_API_KEY" /></FormField> : null}
                {!isLocal ? <FormField label="Giá trị bí mật"><Input value={form.secret} onChange={(event) => setFormValue(setForm, "secret", event.target.value)} type="password" placeholder="Được lưu an toàn và sẽ bị ẩn sau khi lưu" /></FormField> : null}
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input checked={form.setDefault} onChange={(event) => setForm((current) => ({ ...current, setDefault: event.target.checked }))} type="checkbox" />
                Đặt làm model chính sau khi lưu
              </label>
              <Button className="w-fit" type="submit" disabled={loading}><Save /> Lưu kết nối</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-background/35">
          <CardHeader>
            <CardTitle>Mô hình dự phòng</CardTitle>
            <CardDescription>Các mô hình Bestie có thể thử khi mô hình chính không khả dụng.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {data.fallbacks.length ? data.fallbacks.map((candidate) => <ProviderCandidateRow key={candidate.modelRef} candidate={candidate} />) : <p className="text-sm text-muted-foreground">Chưa thêm mô hình dự phòng.</p>}
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
      <AlertTitle>Không tải được mô hình AI</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function ProviderTestNotice({ result, onShown }: { result: ProviderTestResult; onShown: () => void }): ReactElement {
  return <ToastEffect title={result.ok ? "Kiểm tra mô hình thành công" : "Kiểm tra mô hình thất bại"} description={`${result.message ?? result.modelRef}${result.latencyMs ? ` (${result.latencyMs}ms)` : ""}`} tone={result.ok ? "success" : "error"} onShown={onShown} />;
}

function ProviderCandidateCard({ title, candidate, featured = false }: { title: string; candidate?: ProviderCandidate; featured?: boolean }): ReactElement {
  return (
    <Card className={featured ? "border-primary/30 bg-primary/10" : "border-white/10 bg-background/35"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PlugZap className="size-5" /> {title}</CardTitle>
        <CardDescription>{candidate?.authProfile ?? "Chưa chọn mô hình"}</CardDescription>
      </CardHeader>
      <CardContent>{candidate ? <ProviderCandidateRow candidate={candidate} /> : <p className="text-sm text-muted-foreground">Dịch vụ này chưa được thiết lập.</p>}</CardContent>
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
        <Badge variant={candidate.secretPresent ? "secondary" : "destructive"}>{candidate.secretPresent ? "sẵn sàng" : "thiếu khoá bí mật"}</Badge>
      </div>
      <Separator />
      <p><span className="text-muted-foreground">URL gốc:</span> {candidate.baseUrl}</p>
      {candidate.apiKeyEnv ? <p><span className="text-muted-foreground">Tên thông tin xác thực:</span> {candidate.apiKeyEnv}</p> : null}
    </div>
  );
}

function ProviderProfileList({ profiles }: { profiles: ProviderProfile[] }): ReactElement {
  return (
    <Card className="border-white/10 bg-background/35">
      <CardHeader><CardTitle>Kết nối đã lưu</CardTitle><CardDescription>Các phương thức kết nối đã lưu và trạng thái thông tin xác thực.</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        {profiles.map((profile) => (
          <div key={profile.id} className="rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-semibold">{profile.id}</p><Badge variant={profile.secretPresent ? "secondary" : "destructive"}>{profile.secretPresent ? "sẵn sàng" : "thiếu khoá bí mật"}</Badge></div>
            <p className="mt-1 text-muted-foreground">{profile.provider} / {formatProviderMode(profile.mode)}</p>
            <p className="mt-2"><span className="text-muted-foreground">Được dùng bởi:</span> {profile.usedBy.join(", ") || "-"}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ProviderModelList({ models }: { models: ProviderModel[] }): ReactElement {
  return (
    <Card className="border-white/10 bg-background/35">
      <CardHeader><CardTitle>Mô hình có sẵn</CardTitle><CardDescription>Các mô hình Bestie có thể sử dụng.</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        {models.map((model) => (
          <div key={model.modelRef} className="flex flex-wrap items-start justify-between gap-2 rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
            <div><p className="font-semibold">{model.modelRef}</p><p className="text-muted-foreground">{model.profile}</p></div>
            <div className="flex gap-2">{model.primary ? <Badge>Chính</Badge> : null}{model.fallback ? <Badge variant="outline">Dự phòng</Badge> : null}</div>
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

function formatProviderMode(mode: string): string {
  if (mode === "api-key") return "API key";
  if (mode === "local") return "cục bộ";
  return mode;
}
