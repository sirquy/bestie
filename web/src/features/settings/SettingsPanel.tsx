import type { FormEvent, ReactElement } from "react";
import { useEffect, useState } from "react";
import { AlertCircle, Brain, FolderOpen, RefreshCw, Save, Settings, Sparkles, UserRound } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { fetchJson, formatError } from "@/lib/api";
import { ToastEffect } from "@/lib/toasts";
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
  writePolicy: MemoryWritePolicy;
}

export function SettingsPanel({ data, loading, onData, onLoading, onStatusRefresh }: SettingsPanelProps): ReactElement {
  const [draft, setDraft] = useState<SettingsDraft>(() => emptyDraft());
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setDraft({ writePolicy: data.memory.writePolicy });
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

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10">
        <Settings className="size-4" />
        <AlertTitle>Đang tải cài đặt</AlertTitle>
        <AlertDescription>Đang tải các tuỳ chọn an toàn có thể chỉnh sửa.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      {actionError ? <ToastEffect title="Không thể lưu cài đặt" description={actionError} tone="error" onShown={() => setActionError(null)} /> : null}
      {saveMessage ? <ToastEffect title="Đã lưu" description={saveMessage} tone="success" onShown={() => setSaveMessage(null)} /> : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <Card className="border-white/10 bg-background/35">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Settings className="size-5" /> Cài đặt</CardTitle>
              <CardDescription>Tuỳ chọn an toàn cho danh tính, ngôn ngữ, giọng điệu và duyệt bộ nhớ.</CardDescription>
            </div>
            <Button variant="outline" onClick={() => void reload()} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin" : ""} />
              Tải lại
            </Button>
          </CardHeader>
          <CardContent>
            <form id="settings-form" className="grid gap-4" onSubmit={(event) => void save(event)}>
              <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Chế độ duyệt bộ nhớ">
                  <Select name="writePolicy" value={draft.writePolicy} onChange={(event) => setDraftValue(setDraft, "writePolicy", event.target.value as MemoryWritePolicy)}>
                    <option value="ask">Hỏi trước</option>
                    <option value="allow">Cho ph?p</option>
                    <option value="deny">Từ chối</option>
                  </Select>
                </FormField>
              </div>

              <Button className="w-fit" type="submit" disabled={loading}>
                <Save />
                Lưu cài đặt
              </Button>
            </form>
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
  return { writePolicy: "ask" };
}

function setDraftValue<Key extends keyof SettingsDraft>(setDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void, key: Key, value: SettingsDraft[Key]): void {
  setDraft((current) => ({ ...current, [key]: value }));
}
