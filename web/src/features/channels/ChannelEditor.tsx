import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, Save } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, formatError } from "@/lib/api";
import { confirmDialog } from "@/lib/dialogs";
import { ToastEffect } from "@/lib/toasts";
import type { AttachmentConfig, ChannelConfig, ChannelConfigSummary, ChannelId } from "./types";

interface ChannelEditorProps { channelId: ChannelId; onBack: () => void; }
type Draft = Omit<ChannelConfig, "id" | "configured" | "credentialLabel">;
const channelNames: Record<ChannelId, string> = { telegram: "Telegram", zalo: "Zalo OA", "zalo-personal": "Zalo Personal" };
const attachmentKinds = ["photo", "document", "voice", "audio", "video", "sticker"];

export function ChannelEditor({ channelId, onBack }: ChannelEditorProps): ReactElement {
  const [draft, setDraft] = useState<Draft>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function load(): Promise<void> {
    setLoading(true); setError(undefined);
    try {
      const data = await fetchJson<ChannelConfigSummary>("/api/channels/config");
      const channel = data.channels.find((item) => item.id === channelId);
      if (!channel) throw new Error("Không tìm thấy cấu hình channel.");
      setDraft(toDraft(channel));
    } catch (cause) { setError(formatError(cause)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [channelId]);

  async function save(): Promise<void> {
    if (!draft) return;
    if (!draft.ownerUserIds.length) { setError("Cần ít nhất một owner user ID hoặc dùng * cho channel công khai."); return; }
    if (!await confirmDialog({ title: "Lưu cấu hình channel?", description: "Cấu hình sẽ được kiểm tra trước khi lưu. Secret không được lưu trong WebUI.", confirmLabel: "Lưu cấu hình", cancelLabel: "Huỷ" })) return;
    setSaving(true); setError(undefined); setMessage(undefined);
    try {
      const result = await fetchJson<ChannelConfigSummary>("/api/channels/config", { method: "PUT", body: JSON.stringify({ channel: channelId, config: toPayload(channelId, draft), confirm: true }) });
      const updated = result.channels.find((item) => item.id === channelId);
      if (!updated) throw new Error("Không nhận được cấu hình channel sau khi lưu.");
      setDraft(toDraft(updated)); setMessage("Đã lưu cấu hình channel.");
    } catch (cause) { setError(formatError(cause)); }
    finally { setSaving(false); }
  }

  if (loading || !draft) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Đang tải cấu hình channel…</CardContent></Card>;
  const attachments = draft.attachments;
  const updateAttachment = <Key extends keyof AttachmentConfig>(key: Key, value: AttachmentConfig[Key]): void => setDraft((current) => current ? { ...current, attachments: { ...current.attachments, [key]: value } } : current);
  const updateNumber = (key: keyof Draft, value: string): void => setDraft((current) => current ? { ...current, [key]: value.trim() ? Number(value) : undefined } : current);
  const updateAttachmentNumber = (key: keyof AttachmentConfig, value: string): void => updateAttachment(key, value.trim() ? Number(value) : undefined);

  return <div className="grid gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft /> Danh sách kênh</Button><h2 className="mt-2 text-2xl font-semibold">Cấu hình {channelNames[channelId]}</h2><p className="mt-1 text-sm text-muted-foreground">Cấu hình chi tiết theo từng channel. Chỉ hiển thị tên biến môi trường, không hiển thị secret.</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => void load()} disabled={loading || saving}><RefreshCw /> Tải lại</Button><Button onClick={() => void save()} disabled={saving}><Save /> {saving ? "Đang lưu" : "Lưu"}</Button></div></div>
    {error ? <Alert variant="destructive"><AlertTitle>Không thể cập nhật channel</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    {message ? <ToastEffect title={message} tone="success" onShown={() => setMessage(undefined)} /> : null}
    <Card><CardHeader><CardTitle>Trạng thái và quyền truy cập</CardTitle><CardDescription>`*` trong Owner IDs cho phép tất cả người dùng; chỉ dùng khi channel đã binding tới public agent an toàn.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><CheckField label="Bật channel" checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} /><Field label="Owner user IDs"><Textarea value={draft.ownerUserIds.join("\n")} onChange={(event) => setDraft({ ...draft, ownerUserIds: parseLines(event.target.value) })} placeholder={'user-id-1\nuser-id-2\n*'} /></Field><Field label="Admin user IDs"><Textarea value={draft.adminUserIds.join("\n")} onChange={(event) => setDraft({ ...draft, adminUserIds: parseLines(event.target.value) })} placeholder="Để trống nếu không có" /></Field><Field label={channelId === "zalo-personal" ? "Session env" : "Bot token env"}><Input value={draft.credentialEnv} onChange={(event) => setDraft({ ...draft, credentialEnv: event.target.value })} placeholder="BESTIE_CHANNEL_SECRET" /></Field></CardContent></Card>
    {channelId === "telegram" ? <Card><CardHeader><CardTitle>Phản hồi giọng nói</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-3"><Field label="Chính sách"><Select value={draft.voiceReplyPolicy ?? ""} onChange={(event) => setDraft({ ...draft, voiceReplyPolicy: event.target.value === "deny" || event.target.value === "voice-input-only" ? event.target.value : undefined })}><option value="">Theo mặc định</option><option value="deny">Không gửi voice reply</option><option value="voice-input-only">Chỉ trả lời voice khi input là voice</option></Select></Field><NumberField label="Tối đa ký tự" value={draft.voiceReplyMaxChars} onChange={(value) => updateNumber("voiceReplyMaxChars", value)} /><NumberField label="Cooldown (ms)" value={draft.voiceReplyCooldownMs} onChange={(value) => updateNumber("voiceReplyCooldownMs", value)} /></CardContent></Card> : null}
    {channelId === "zalo" ? <Card><CardHeader><CardTitle>Polling</CardTitle></CardHeader><CardContent className="max-w-sm"><NumberField label="Polling timeout (giây)" value={draft.pollingTimeoutSeconds} onChange={(value) => updateNumber("pollingTimeoutSeconds", value)} /></CardContent></Card> : null}
    {channelId === "zalo-personal" ? <Card><CardHeader><CardTitle>Kết nối lại</CardTitle><CardDescription>Zalo Personal là integration experimental/unofficial.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><NumberField label="Initial delay (ms)" value={draft.reconnect?.initialDelayMs} onChange={(value) => setDraft({ ...draft, reconnect: { ...draft.reconnect, initialDelayMs: value ? Number(value) : undefined } })} /><NumberField label="Max delay (ms)" value={draft.reconnect?.maxDelayMs} onChange={(value) => setDraft({ ...draft, reconnect: { ...draft.reconnect, maxDelayMs: value ? Number(value) : undefined } })} /></CardContent></Card> : null}
    <Card><CardHeader><CardTitle>Attachment, vision và transcription</CardTitle><CardDescription>Để trống số lượng để dùng mặc định runtime. Giá trị byte phải là số nguyên dương.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><Field label="Cho phép tải file"><Select value={attachments.downloadPolicy ?? ""} onChange={(event) => updateAttachment("downloadPolicy", event.target.value ? event.target.value as "allow" | "deny" : undefined)}><option value="">Theo mặc định</option><option value="allow">Cho phép</option><option value="deny">Chặn</option></Select></Field><NumberField label="Kích thước tải tối đa (bytes)" value={attachments.maxBytes} onChange={(value) => updateAttachmentNumber("maxBytes", value)} /><NumberField label="Preview tối đa (bytes)" value={attachments.previewMaxBytes} onChange={(value) => updateAttachmentNumber("previewMaxBytes", value)} /><NumberField label="Parse tối đa (bytes)" value={attachments.parseMaxBytes} onChange={(value) => updateAttachmentNumber("parseMaxBytes", value)} /><Field label="Vision"><Select value={attachments.visionPolicy ?? ""} onChange={(event) => updateAttachment("visionPolicy", event.target.value ? event.target.value as "allow" | "deny" : undefined)}><option value="">Theo mặc định</option><option value="allow">Cho phép</option><option value="deny">Chặn</option></Select></Field><NumberField label="Vision tối đa (bytes)" value={attachments.visionMaxBytes} onChange={(value) => updateAttachmentNumber("visionMaxBytes", value)} /><Field label="Transcription"><Select value={attachments.transcriptionPolicy ?? ""} onChange={(event) => updateAttachment("transcriptionPolicy", event.target.value ? event.target.value as "allow" | "deny" : undefined)}><option value="">Theo mặc định</option><option value="allow">Cho phép</option><option value="deny">Chặn</option></Select></Field><NumberField label="Transcription tối đa (bytes)" value={attachments.transcriptionMaxBytes} onChange={(value) => updateAttachmentNumber("transcriptionMaxBytes", value)} /><Field label="MIME types được phép"><Textarea value={(attachments.allowedMimeTypes ?? []).join("\n")} onChange={(event) => updateAttachment("allowedMimeTypes", parseLines(event.target.value))} placeholder={'image/png\naudio/ogg'} /></Field><Field label="Xoá sau xử lý"><div className="grid grid-cols-2 gap-2 rounded-md border border-input p-3">{attachmentKinds.map((kind) => <CheckField key={kind} label={kind} checked={attachments.deleteAfterProcessingKinds?.includes(kind) ?? false} onChange={(checked) => updateAttachment("deleteAfterProcessingKinds", checked ? [...new Set([...(attachments.deleteAfterProcessingKinds ?? []), kind])] : (attachments.deleteAfterProcessingKinds ?? []).filter((item) => item !== kind))} />)}</div></Field></CardContent></Card>
  </div>;
}

function toDraft(channel: ChannelConfig): Draft { const { id: _id, configured: _configured, credentialLabel: _label, ...draft } = channel; return draft; }
function toPayload(channelId: ChannelId, draft: Draft): Record<string, unknown> {
  return {
    enabled: draft.enabled,
    ownerUserId: draft.ownerUserIds,
    adminUserIds: draft.adminUserIds.length ? draft.adminUserIds : null,
    ...(draft.credentialEnv.trim() ? { [channelId === "zalo-personal" ? "sessionEnv" : "botTokenEnv"]: draft.credentialEnv.trim() } : {}),
    pollingTimeoutSeconds: draft.pollingTimeoutSeconds ?? null,
    voiceReplyPolicy: draft.voiceReplyPolicy ?? null,
    voiceReplyMaxChars: draft.voiceReplyMaxChars ?? null,
    voiceReplyCooldownMs: draft.voiceReplyCooldownMs ?? null,
    reconnect: { initialDelayMs: draft.reconnect?.initialDelayMs ?? null, maxDelayMs: draft.reconnect?.maxDelayMs ?? null },
    attachments: {
      downloadPolicy: draft.attachments.downloadPolicy ?? null,
      maxBytes: draft.attachments.maxBytes ?? null,
      previewMaxBytes: draft.attachments.previewMaxBytes ?? null,
      parseMaxBytes: draft.attachments.parseMaxBytes ?? null,
      visionPolicy: draft.attachments.visionPolicy ?? null,
      visionMaxBytes: draft.attachments.visionMaxBytes ?? null,
      transcriptionPolicy: draft.attachments.transcriptionPolicy ?? null,
      transcriptionMaxBytes: draft.attachments.transcriptionMaxBytes ?? null,
      deleteAfterProcessingKinds: draft.attachments.deleteAfterProcessingKinds?.length ? draft.attachments.deleteAfterProcessingKinds : null,
      allowedMimeTypes: draft.attachments.allowedMimeTypes?.length ? draft.attachments.allowedMimeTypes : null,
    },
  };
}
function parseLines(value: string): string[] { return Array.from(new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))); }
function Field({ label, children }: { label: string; children: ReactElement }): ReactElement { return <div className="grid gap-2"><Label>{label}</Label>{children}</div>; }
function NumberField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (value: string) => void }): ReactElement { return <Field label={label}><Input type="number" min="0" value={value ?? ""} onChange={(event) => onChange(event.target.value)} /></Field>; }
function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }): ReactElement { return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>; }
