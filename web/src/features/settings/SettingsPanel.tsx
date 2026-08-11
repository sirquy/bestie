import type { FormEvent, ReactElement } from "react";
import { useEffect, useState } from "react";
import { AlertCircle, Brain, FolderOpen, KeyRound, Link, LockKeyhole, RefreshCw, Save, Settings, ShieldCheck, Signal } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { fetchJson, formatError, setCsrfToken } from "@/lib/api";
import { ToastEffect } from "@/lib/toasts";
import { confirmDialog } from "@/lib/dialogs";
import type { MemoryWritePolicy, SettingsSummary, TunnelSummary } from "./types";

interface SettingsPanelProps {
  data?: SettingsSummary;
  loading: boolean;
  page: string;
  onNavigate: (route: string) => void;
  onData: (data: SettingsSummary) => void;
  onLoading: (loading: boolean) => void;
  onStatusRefresh?: () => void;
  onLocked?: () => void;
}

interface SettingsDraft {
  writePolicy: MemoryWritePolicy;
}

interface UiSessionStatus {
  authenticated: boolean;
  session?: {
    idleExpiresAt: string;
    sessionExpiresAt: string;
  };
}

export function SettingsPanel({ data, loading, page, onNavigate, onData, onLoading, onStatusRefresh, onLocked }: SettingsPanelProps): ReactElement {
  const [draft, setDraft] = useState<SettingsDraft>(() => emptyDraft());
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState({ currentPin: "", nextPin: "", confirmation: "" });
  const [pinBusy, setPinBusy] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<UiSessionStatus>();
  const [tunnel, setTunnel] = useState<TunnelSummary>();
  const [tunnelBusy, setTunnelBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setDraft({ writePolicy: data.memory.writePolicy });
  }, [data]);

  useEffect(() => {
    async function refreshSession(): Promise<void> {
      try {
        setSessionStatus(await fetchJson<UiSessionStatus>("/api/auth/status"));
      } catch {
        setSessionStatus({ authenticated: false });
      }
    }
    void refreshSession();
    const timer = window.setInterval(() => void refreshSession(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (page !== "/settings/remote-access") return;
    void fetchJson<TunnelSummary>("/api/settings/tunnel").then(setTunnel).catch((error: unknown) => setActionError(formatError(error)));
  }, [page]);

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
    if (!await confirmDialog("Lưu cài đặt hệ thống?")) return;
    await runAction(() => fetchJson<SettingsSummary>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        memory: {
          writePolicy: draft.writePolicy,
        },
        confirm: true,
      }),
    }), "Đã lưu cài đặt.");
  }

  async function changePin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!/^\d{6}$/.test(pinDraft.currentPin) || !/^\d{6}$/.test(pinDraft.nextPin)) {
      setActionError("Mã hiện tại và mã mới cần đúng 6 chữ số.");
      return;
    }
    if (pinDraft.nextPin !== pinDraft.confirmation) {
      setActionError("Mã mở khóa mới và phần nhập lại chưa khớp.");
      return;
    }
    if (!await confirmDialog("Đổi mã mở khóa? Bạn sẽ cần dùng mã mới để mở Bestie ngay sau thao tác này.")) return;
    setPinBusy(true);
    setActionError(null);
    try {
      await fetchJson("/api/auth/change-pin", { method: "POST", body: JSON.stringify({ currentPin: pinDraft.currentPin, nextPin: pinDraft.nextPin }) });
      setCsrfToken(undefined);
      onLocked?.();
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      setPinBusy(false);
    }
  }

  async function lockNow(): Promise<void> {
    if (!await confirmDialog("Khóa Bestie ngay? Bạn sẽ cần nhập mã mở khóa để tiếp tục.")) return;
    setPinBusy(true);
    try {
      await fetchJson("/api/auth/logout", { method: "POST" });
      setCsrfToken(undefined);
      onLocked?.();
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      setPinBusy(false);
    }
  }

  async function runTunnelAction(action: "setup" | "start" | "stop" | "revoke"): Promise<void> {
    const labels = { setup: "Cấp URL truy cập từ xa", start: "Bật truy cập từ xa", stop: "Dừng truy cập từ xa", revoke: "Thu hồi URL truy cập từ xa" };
    const description = action === "revoke"
      ? `Thu hồi vĩnh viễn ${tunnel?.tunnel?.hostname ?? "URL tunnel"}? Thao tác này không thể hoàn tác.`
      : `${labels[action]} qua Cloudflare Tunnel? Bestie vẫn chỉ lắng nghe tại localhost.`;
    if (!await confirmDialog({ title: labels[action], description, confirmLabel: action === "revoke" ? "Thu hồi" : "Xác nhận", cancelLabel: "Hủy", tone: action === "revoke" ? "destructive" : "default" })) return;
    setTunnelBusy(true);
    setActionError(null);
    try {
      const result = await fetchJson<TunnelSummary>("/api/settings/tunnel/action", { method: "POST", body: JSON.stringify({ action, confirm: true }) });
      setTunnel(result);
      setSaveMessage(action === "revoke" ? "Đã thu hồi URL truy cập từ xa." : "Đã cập nhật trạng thái truy cập từ xa.");
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      setTunnelBusy(false);
    }
  }

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10">
        <Settings className="size-4" />
        <AlertTitle>Đang tải cài đặt</AlertTitle>
        <AlertDescription>Đang tải các tuỳ chọn an toàn có thể chỉnh sửa.</AlertDescription>
      </Alert>
    );
  }

  const activePage = page === "/settings/memory" || page === "/settings/security" || page === "/settings/remote-access" ? page : "/settings/general";

  return (
    <div className="grid gap-4">
      {actionError ? <ToastEffect title="Không thể lưu cài đặt" description={actionError} tone="error" onShown={() => setActionError(null)} /> : null}
      {saveMessage ? <ToastEffect title="Đã lưu" description={saveMessage} tone="success" onShown={() => setSaveMessage(null)} /> : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SettingsPageTabs active={activePage} onNavigate={onNavigate} />
        <Button variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Tải lại</Button>
      </div>

      <div className="grid gap-4">
        {activePage === "/settings/general" ? <>
        <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <Card className="border-white/10 bg-background/35">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><Settings className="size-5" /> Tổng quan cài đặt</CardTitle>
              <CardDescription>Thông tin nhận diện và cấu hình runtime hiện tại của Bestie.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 text-sm sm:grid-cols-2"><SummaryRow label="Tên trợ lý" value={data.agent.name} /><SummaryRow label="Chủ sở hữu" value={data.agent.ownerName} /><SummaryRow label="Ngôn ngữ" value={data.agent.language} /><SummaryRow label="Múi giờ" value={data.agent.timeZone ?? "-"} /></div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <SettingsSummaryCard title="Trợ lý" icon={<Settings className="size-5" />} rows={[
            ["Tên", data.agent.name],
            ["Chủ sở hữu", data.agent.ownerName],
            ["Ngôn ngữ", data.agent.language],
            ["Múi giờ", data.agent.timeZone ?? "-"],
          ]} />
          <SettingsSummaryCard title="Bộ nhớ" icon={<Brain className="size-5" />} rows={[
            ["Quyền ghi", data.memory.writePolicy],
          ]} />
          <SettingsSummaryCard title="Thư mục" icon={<FolderOpen className="size-5" />} rows={[
            ["Thư mục mặc định", data.workspace.defaultPath ?? "-"],
            ["Thư mục ngoài", String(data.workspace.externalPathCount)],
          ]} />
        </div>
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader>
          <CardTitle>Tóm tắt thiết lập AI</CardTitle>
          <CardDescription>Chỉ hiển thị ở đây. Vào Nhà cung cấp để đổi dịch vụ AI.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <MiniMetric label="Chính" value={data.llm.primary} />
          <MiniMetric label="Hồ sơ xác thực" value={data.llm.authProfile} />
          <MiniMetric label="Dự phòng" value={String(data.llm.fallbackCount)} />
          <MiniMetric label="Kết nối" value={String(data.llm.profileCount)} />
          <MiniMetric label="Model" value={String(data.llm.modelCount)} />
        </CardContent>
      </Card>
        </> : null}
        {activePage === "/settings/memory" ? <Card className="border-white/10 bg-background/35"><CardHeader><CardTitle className="flex items-center gap-2"><Brain className="size-5" /> Bộ nhớ</CardTitle><CardDescription>Chọn cách Bestie xử lý đề xuất ghi nhớ mới.</CardDescription></CardHeader><CardContent><form className="grid max-w-xl gap-4" onSubmit={(event) => void save(event)}><FormField label="Chế độ duyệt bộ nhớ"><Select name="writePolicy" value={draft.writePolicy} onChange={(event) => setDraftValue(setDraft, "writePolicy", event.target.value as MemoryWritePolicy)}><option value="ask">Hỏi trước</option><option value="allow">Cho phép</option><option value="deny">Từ chối</option></Select></FormField><Button className="w-fit" type="submit" disabled={loading}><Save />Lưu chính sách</Button></form></CardContent></Card> : null}
        {activePage === "/settings/security" ? <Card className="border-white/10 bg-background/35"><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" /> Bảo mật UI</CardTitle><CardDescription>Xem phiên mở khóa, khóa ngay hoặc đổi mã trên máy này.</CardDescription></CardHeader><CardContent><div className="mb-6 grid gap-3 rounded-lg border border-white/10 bg-card/40 p-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="font-medium">{sessionStatus?.authenticated ? "Bestie đang mở khóa trên máy này" : "Phiên mở khóa đã kết thúc"}</p>{sessionStatus?.session ? <p className="mt-1 text-sm text-muted-foreground">Tự khóa sau {formatRemaining(sessionStatus.session.idleExpiresAt)} không hoạt động; phiên hết hạn sau {formatRemaining(sessionStatus.session.sessionExpiresAt)}.</p> : null}</div><Button className="w-fit" disabled={!sessionStatus?.authenticated || pinBusy} onClick={() => void lockNow()} type="button" variant="outline"><ShieldCheck /> Khóa Bestie</Button></div><form className="grid max-w-xl gap-4" onSubmit={(event) => void changePin(event)}><PinField autoComplete="current-password" id="current-unlock-pin" label="Mã mở khóa hiện tại" value={pinDraft.currentPin} onChange={(value) => setPinDraft((current) => ({ ...current, currentPin: value }))} /><div className="grid gap-4 md:grid-cols-2"><PinField autoComplete="new-password" id="next-unlock-pin" label="Mã mở khóa mới" value={pinDraft.nextPin} onChange={(value) => setPinDraft((current) => ({ ...current, nextPin: value }))} /><PinField autoComplete="new-password" id="next-unlock-pin-confirmation" label="Nhập lại mã mới" value={pinDraft.confirmation} onChange={(value) => setPinDraft((current) => ({ ...current, confirmation: value }))} /></div><Button className="w-fit" disabled={pinBusy} type="submit"><KeyRound />{pinBusy ? "Đang đổi mã..." : "Đổi mã mở khóa"}</Button></form></CardContent></Card> : null}
        {activePage === "/settings/remote-access" ? <RemoteAccessPage tunnel={tunnel} busy={tunnelBusy} onAction={runTunnelAction} /> : null}
      </div>

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
      <AlertTitle>Không tải được cài đặt</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function SettingsPageTabs({ active, onNavigate }: { active: string; onNavigate: (route: string) => void }): ReactElement {
  return <div className="flex w-fit max-w-full overflow-x-auto rounded-2xl border border-white/10 bg-background/35 p-1" aria-label="Nhóm cài đặt"><Button size="sm" type="button" variant={active === "/settings/general" ? "secondary" : "ghost"} onClick={() => onNavigate("/settings/general")}>Chung</Button><Button size="sm" type="button" variant={active === "/settings/memory" ? "secondary" : "ghost"} onClick={() => onNavigate("/settings/memory")}>Bộ nhớ</Button><Button size="sm" type="button" variant={active === "/settings/security" ? "secondary" : "ghost"} onClick={() => onNavigate("/settings/security")}>Bảo mật</Button><Button size="sm" type="button" variant={active === "/settings/remote-access" ? "secondary" : "ghost"} onClick={() => onNavigate("/settings/remote-access")}>Truy cập từ xa</Button></div>;
}

function RemoteAccessPage({ tunnel, busy, onAction }: { tunnel?: TunnelSummary; busy: boolean; onAction: (action: "setup" | "start" | "stop" | "revoke") => Promise<void> }): ReactElement {
  const configured = tunnel?.tunnel;
  return (
    <Card className="border-white/10 bg-background/35">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><CardTitle className="flex items-center gap-2"><Signal className="size-5" /> Truy cập từ xa</CardTitle><CardDescription>Cloudflare Tunnel chỉ chuyển tiếp tới Bestie UI tại localhost. Mã mở khóa UI vẫn bắt buộc.</CardDescription></div>
        {configured ? <span className="w-fit rounded-md border border-white/10 bg-card px-2 py-1 text-xs font-medium">{configured.connectorRunning ? "Đang kết nối" : configured.status}</span> : null}
      </CardHeader>
      <CardContent className="grid gap-5">
        {configured ? <div className="grid gap-3 rounded-lg border border-white/10 bg-card/40 p-4"><div><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">URL riêng</p><a className="mt-1 block break-all font-medium text-primary underline-offset-4 hover:underline" href={configured.url} rel="noreferrer" target="_blank">{configured.url}</a></div><div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2"><span>Trạng thái: {configured.status}</span><span>Cập nhật: {new Date(configured.updatedAt).toLocaleString()}</span></div>{configured.failureCode ? <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">Tunnel provider lỗi: {configured.failureCode}{configured.failureMessage ? ` - ${configured.failureMessage}` : ""}</p> : null}</div> : <div className="rounded-lg border border-dashed border-white/15 p-5 text-sm text-muted-foreground">Chưa có URL truy cập từ xa. Cấp một tunnel để truy cập Bestie từ thiết bị khác.</div>}
        <div className="flex flex-wrap gap-2">
          {!configured ? <Button disabled={busy} onClick={() => void onAction("setup")} type="button"><Link />{busy ? "Đang cấp..." : "Cấp URL từ xa"}</Button> : null}
          {configured && !configured.connectorRunning ? <Button disabled={busy} onClick={() => void onAction("start")} type="button"><Signal />{busy ? "Đang khởi động..." : "Bật truy cập"}</Button> : null}
          {configured?.connectorRunning ? <Button disabled={busy} onClick={() => void onAction("stop")} type="button" variant="outline"><Signal />{busy ? "Đang dừng..." : "Dừng truy cập"}</Button> : null}
          {configured ? <Button disabled={busy} onClick={() => void onAction("revoke")} type="button" variant="destructive">Thu hồi URL</Button> : null}
        </div>
      </CardContent>
    </Card>
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

function PinField({ id, label, value, onChange, autoComplete }: { id: string; label: string; value: string; onChange: (value: string) => void; autoComplete: "current-password" | "new-password" }): ReactElement {
  return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label><Input id={id} type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))} /></div>;
}

function formatRemaining(expiresAt: string): string {
  const milliseconds = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes < 60) return `${minutes} phút`;
  return `${Math.ceil(minutes / 60)} giờ`;
}

function emptyDraft(): SettingsDraft {
  return { writePolicy: "ask" };
}

function setDraftValue<Key extends keyof SettingsDraft>(setDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void, key: Key, value: SettingsDraft[Key]): void {
  setDraft((current) => ({ ...current, [key]: value }));
}
