import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, KeyRound, LoaderCircle, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { providerPresets, type ProviderPreset } from "@/features/providers/types";
import { fetchJson, formatError } from "@/lib/api";

interface OnboardingScreenProps { onComplete: () => Promise<void>; }
interface OnboardingResult { ok: true; modelRef: string; }
interface ProviderTestResult { ok: boolean; message?: string; latencyMs?: number; }

const presets = providerPresets.filter((preset) => preset.mode !== "oauth");

export function OnboardingScreen({ onComplete }: OnboardingScreenProps): ReactElement {
  const [step, setStep] = useState(1);
  const [agentName, setAgentName] = useState("Bestie");
  const [ownerName, setOwnerName] = useState("");
  const [presetId, setPresetId] = useState<ProviderPreset["id"]>("openai");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ProviderTestResult>();
  const preset = useMemo(() => presets.find((item) => item.id === presetId) ?? presets[0], [presetId]);
  const needsKey = preset.mode === "api-key";
  const supportsBaseUrl = Boolean(preset.baseUrl) && preset.id !== "gemini";

  async function saveAndTest(): Promise<void> {
    setBusy(true); setError(undefined);
    try {
      const setup = await fetchJson<OnboardingResult>("/api/onboarding", { method: "POST", body: JSON.stringify({ agentName, ownerName, language: "vi", toneIntensity: 7, provider: preset.id, mode: preset.mode, model: model.trim() || preset.model, ...(baseUrl.trim() || preset.baseUrl ? { baseUrl: baseUrl.trim() || preset.baseUrl } : {}), ...(needsKey ? { apiKeyEnv: preset.apiKeyEnv, secret: apiKey } : {}) }) });
      const test = await fetchJson<ProviderTestResult>("/api/providers/test", { method: "POST", body: JSON.stringify({ modelRef: setup.modelRef }) });
      setResult(test);
      if (test.ok) setStep(3); else setError(test.message || "Không thể kết nối provider. Kiểm tra API key, model và mạng rồi thử lại.");
    } catch (requestError) { setError(formatError(requestError)); } finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-[radial-gradient(circle_at_15%_0%,rgba(166,244,172,0.16),transparent_28rem),radial-gradient(circle_at_90%_20%,rgba(255,181,91,0.16),transparent_30rem)] px-4 py-8 text-foreground md:py-16"><div className="mx-auto w-full max-w-3xl"><div className="mb-8 flex items-center gap-3"><div className="rounded-2xl bg-primary p-3 text-primary-foreground"><Sparkles /></div><div><p className="text-lg font-bold">Chào, mình là Bestie.</p><p className="text-sm text-muted-foreground">Thiết lập trong vài phút, rồi nhận câu trả lời thật ngay.</p></div></div><div className="mb-6 flex gap-2">{["Tạo Bestie", "Kết nối AI", "Sẵn sàng"].map((label, index) => <div key={label} className="flex flex-1 items-center gap-2"><span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${step >= index + 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{index + 1}</span><span className="hidden text-sm md:inline">{label}</span>{index < 2 ? <span className="h-px flex-1 bg-border" /> : null}</div>)}</div><Card>{step === 1 ? <><CardHeader><CardTitle>Tạo người bạn đồng hành của bạn</CardTitle><CardDescription>Thông tin này chỉ dùng để cá nhân hoá Bestie trên máy của bạn.</CardDescription></CardHeader><CardContent className="grid gap-5"><Field label="Tên của Bestie"><Input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="Ví dụ: Miu" autoFocus /></Field><Field label="Bestie gọi bạn là gì?"><Input value={ownerName} onChange={(event) => setOwnerName(event.target.value)} placeholder="Ví dụ: Quỳnh" /></Field><Button className="justify-self-end" size="lg" disabled={!agentName.trim() || !ownerName.trim()} onClick={() => setStep(2)}>Tiếp tục <ChevronRight /></Button></CardContent></> : null}{step === 2 ? <><CardHeader><CardTitle>Kết nối model AI</CardTitle><CardDescription>API key được lưu cục bộ trong `~/.bestie/.env`, không được hiển thị lại hay ghi vào log.</CardDescription></CardHeader><CardContent className="grid gap-5"><Field label="Nhà cung cấp"><Select value={presetId} onChange={(event) => { setPresetId(event.target.value as ProviderPreset["id"]); setModel(""); setBaseUrl(""); setApiKey(""); setError(undefined); }}>{presets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></Field><p className="-mt-3 text-sm text-muted-foreground">{preset.note}</p><Field label="Model"><Input value={model} onChange={(event) => setModel(event.target.value)} placeholder={preset.model} /></Field>{supportsBaseUrl ? <Field label="Base URL"><Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={preset.baseUrl} /></Field> : null}{needsKey ? <Field label="API key"><div className="relative"><KeyRound className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={`Nhập ${preset.label} API key`} autoComplete="off" /></div></Field> : null}{error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}<div className="flex justify-between gap-3"><Button variant="outline" onClick={() => setStep(1)} disabled={busy}>Quay lại</Button><Button size="lg" onClick={() => void saveAndTest()} disabled={busy || (needsKey && !apiKey.trim())}>{busy ? <><LoaderCircle className="animate-spin" /> Đang kết nối...</> : "Lưu & kiểm tra kết nối"}</Button></div></CardContent></> : null}{step === 3 ? <><CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="text-primary" /> Kết nối thành công</CardTitle><CardDescription>{result?.latencyMs ? `Provider phản hồi trong ${result.latencyMs} ms.` : "Provider đã sẵn sàng phản hồi."} Bestie đã sẵn sàng cho lượt trò chuyện đầu tiên.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-3"><Button size="lg" onClick={() => void onComplete()} disabled={busy}>Bắt đầu trò chuyện <ChevronRight /></Button><Button variant="outline" onClick={() => setStep(2)} disabled={busy}>Đổi provider</Button></CardContent></> : null}</Card></div></main>;
}

function Field({ label, children }: { label: string; children: ReactElement }): ReactElement { return <label className="grid gap-2"><Label>{label}</Label>{children}</label>; }
