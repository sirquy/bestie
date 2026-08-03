import type { FormEvent, ReactElement } from "react";
import { useMemo, useState } from "react";
import { AlertCircle, BookOpen, Check, Code2, Download, FileText, Library, RefreshCw, RotateCcw, Save, Search, ShieldCheck, Trash2, WandSparkles } from "lucide-react";

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
import type { Skill, SkillItemResponse, SkillLibraryDiff, SkillLibraryItem, SkillLibraryItemResponse, SkillLibrarySummary, SkillRemoteRegistryTestResult, SkillsSummary } from "./types";

interface SkillsPanelProps {
  data?: SkillsSummary;
  loading: boolean;
  onData: (data: SkillsSummary) => void;
  onLoading: (loading: boolean) => void;
}

type SkillMode = "installed" | "library";

export function SkillsPanel({ data, loading, onData, onLoading }: SkillsPanelProps): ReactElement {
  const [mode, setMode] = useState<SkillMode>("installed");
  const [library, setLibrary] = useState<SkillLibrarySummary | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<SkillItemResponse | null>(null);
  const [selectedLibraryItem, setSelectedLibraryItem] = useState<SkillLibraryItemResponse | null>(null);
  const [selectedDiff, setSelectedDiff] = useState<SkillLibraryDiff | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const filteredInstalled = useMemo(() => filterInstalled(data?.skills ?? [], query), [data, query]);
  const filteredLibrary = useMemo(() => filterLibrary(library?.skills ?? [], query), [library, query]);

  async function runSummaryAction(action: () => Promise<SkillsSummary>, success?: string): Promise<void> {
    setActionError(null);
    setActionMessage(null);
    onLoading(true);
    try {
      const nextData = await action();
      onData(nextData);
      if (success) setActionMessage(success);
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      onLoading(false);
    }
  }

  async function reloadInstalled(): Promise<void> {
    await runSummaryAction(() => fetchJson<SkillsSummary>("/api/skills"));
  }

  async function loadLibrary(): Promise<void> {
    setActionError(null);
    setLibraryLoading(true);
    try {
      setLibrary(await fetchJson<SkillLibrarySummary>("/api/skills/library"));
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      setLibraryLoading(false);
    }
  }

  async function openSkill(name: string): Promise<void> {
    setActionError(null);
    try {
      const skill = await fetchJson<SkillItemResponse>(`/api/skills/item?name=${encodeURIComponent(name)}`);
      setSelectedSkill(skill);
      setSelectedLibraryItem(null);
      setSelectedDiff(null);
      setDraftName(skill.name);
      setDraftContent(skill.content);
      setMode("installed");
    } catch (error: unknown) {
      setActionError(formatError(error));
    }
  }

  async function openLibraryItem(item: SkillLibraryItem): Promise<void> {
    setActionError(null);
    try {
      const params = `name=${encodeURIComponent(item.name)}&sourceId=${encodeURIComponent(item.sourceId)}`;
      const [libraryItem, diff] = await Promise.all([
        fetchJson<SkillLibraryItemResponse>(`/api/skills/library/item?${params}`),
        fetchJson<SkillLibraryDiff>(`/api/skills/library/diff?${params}`),
      ]);
      setSelectedLibraryItem(libraryItem);
      setSelectedDiff(diff);
      setSelectedSkill(null);
      setDraftName(libraryItem.skill.name);
      setDraftContent(libraryItem.content);
      setMode("library");
    } catch (error: unknown) {
      setActionError(formatError(error));
    }
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const previousName = selectedSkill?.name;
    await runSummaryAction(
      () => fetchJson<SkillsSummary>("/api/skills/item", { method: "PUT", body: JSON.stringify({ name: draftName, content: draftContent, previousName }) }),
      `Đã lưu kỹ năng ${draftName}.`,
    );
    setSelectedSkill(null);
  }

  async function confirmSkillAction(endpoint: string, body: Record<string, unknown>, confirmText: string, success: string): Promise<void> {
    if (!await confirmDialog(confirmText)) return;
    await runSummaryAction(() => fetchJson<SkillsSummary>(endpoint, { method: "POST", body: JSON.stringify({ ...body, confirm: true }) }), success);
    if (body.name === selectedSkill?.name) setSelectedSkill(null);
  }

  async function installLibrarySkill(item: SkillLibraryItem): Promise<void> {
    await confirmSkillAction("/api/skills/install", { name: item.name, sourceId: item.sourceId }, `Cài kỹ năng ${item.name}?`, `Đã cài kỹ năng ${item.name}.`);
    await loadLibrary();
  }

  async function testRemoteRegistry(): Promise<void> {
    if (!await confirmDialog("Kiểm tra thư viện kỹ năng từ xa? Thao tác này có thể dùng mạng.")) return;
    setActionError(null);
    setActionMessage(null);
    setLibraryLoading(true);
    try {
      const result = await fetchJson<SkillRemoteRegistryTestResult>("/api/skills/registry/test", { method: "POST", body: JSON.stringify({ confirm: true }) });
      setActionMessage(result.error ? `Không thể kiểm tra thư viện kỹ năng: ${result.error}` : result.configured ? "Thư viện kỹ năng đã sẵn sàng." : "Chưa kết nối thư viện kỹ năng.");
      await loadLibrary();
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      setLibraryLoading(false);
    }
  }

  async function clearRegistryCache(): Promise<void> {
    if (!await confirmDialog("Xoá bộ nhớ đệm thư viện kỹ năng từ xa?")) return;
    setActionError(null);
    setActionMessage(null);
    setLibraryLoading(true);
    try {
      setLibrary(await fetchJson<SkillLibrarySummary>("/api/skills/registry/cache/clear", { method: "POST", body: JSON.stringify({ confirm: true }) }));
      setActionMessage("Đã xoá bộ nhớ đệm thư viện từ xa.");
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      setLibraryLoading(false);
    }
  }

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10">
        <WandSparkles className="size-4" />
        <AlertTitle>Đang tải kỹ năng</AlertTitle>
        <AlertDescription>Đang tải kỹ năng đã cài cho Bestie.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      {actionError ? <SkillsError message={actionError} /> : null}
      {actionMessage ? <Alert className="border-primary/40 bg-primary/10"><Check className="size-4" /><AlertTitle>Kỹ năng đã cập nhật</AlertTitle><AlertDescription>{actionMessage}</AlertDescription></Alert> : null}

      <div className="grid gap-3 md:grid-cols-4" data-skills-summary>
        <Metric label="Đã cài" value={String(data.count)} tone="good" />
        <Metric label="Đã bật" value={String(data.skills.filter((skill) => skill.enabled).length)} />
        <Metric label="Thay đổi cục bộ" value={String(data.skills.filter((skill) => skill.localChanges).length)} tone={data.skills.some((skill) => skill.localChanges) ? "warn" : "neutral"} />
        <Metric label="Thư viện" value={library ? String(library.count) : "chưa tải"} />
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><BookOpen className="size-5" /> Không gian kỹ năng</CardTitle>
            <CardDescription>{data.skillsDir}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant={mode === "installed" ? "default" : "outline"} onClick={() => setMode("installed")}>Đã cài</Button>
            <Button variant={mode === "library" ? "default" : "outline"} onClick={() => { setMode("library"); if (!library && !libraryLoading) void loadLibrary(); }}>Thư viện</Button>
            <Button variant="outline" onClick={() => void reloadInstalled()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Tải lại</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm kỹ năng theo tên, mô tả, danh mục hoặc quyền" />
            <Button type="button" variant="outline" onClick={() => setQuery("")}><Search /> Xoá lọc</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="border-white/10 bg-background/35">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">{mode === "library" ? <Library className="size-5" /> : <FileText className="size-5" />} {mode === "library" ? "Danh mục thư viện" : "Kỹ năng đã cài"}</CardTitle>
            <CardDescription>{mode === "library" ? "Cài kỹ năng chính thức/đã xác minh sau khi bạn xác nhận." : "Mở kỹ năng để xem hoặc chỉnh nội dung hướng dẫn."}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {mode === "library" ? (
              <LibraryList library={library} loading={libraryLoading} items={filteredLibrary} onReload={loadLibrary} onOpen={openLibraryItem} onInstall={installLibrarySkill} onTest={testRemoteRegistry} onClearCache={clearRegistryCache} />
            ) : filteredInstalled.length ? (
              filteredInstalled.map((skill) => <InstalledSkillRow key={skill.name} skill={skill} loading={loading} onOpen={openSkill} onToggle={(enabled) => confirmSkillAction("/api/skills/toggle", { name: skill.name, enabled }, `${enabled ? "Bật" : "Tắt"} kỹ năng ${skill.name}?`, `Đã ${enabled ? "bật" : "tắt"} kỹ năng ${skill.name}.`)} onDelete={() => confirmSkillAction("/api/skills/delete", { name: skill.name }, `Xoá kỹ năng ${skill.name}? Kỹ năng sẽ được lưu trữ trước khi xoá.`, `Đã xoá kỹ năng ${skill.name}.`)} onRollback={() => confirmSkillAction("/api/skills/rollback", { name: skill.name }, `Khôi phục kỹ năng ${skill.name} về bản sao lưu mới nhất?`, `Đã khôi phục kỹ năng ${skill.name}.`)} />)
            ) : <EmptyText>Không tìm thấy kỹ năng đã cài.</EmptyText>}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-background/35" data-skill-editor>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Code2 className="size-5" /> Trình sửa kỹ năng</CardTitle>
            <CardDescription>{selectedLibraryItem ? "Xem trước nội dung thư viện trước khi cài." : "Chỉnh nội dung kỹ năng cục bộ. Không lưu bí mật trong kỹ năng."}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={(event) => void saveDraft(event)}>
              <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
                <div className="grid gap-2">
                  <Label htmlFor="skill-name">Tên kỹ năng</Label>
                  <Input id="skill-name" value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="my-skill" data-skill-name-input />
                </div>
                <Button type="button" variant="outline" onClick={() => { setSelectedSkill(null); setSelectedLibraryItem(null); setSelectedDiff(null); setDraftName("new-skill"); setDraftContent("# Kỹ năng mới\\n\\nMô tả khi nào và cách Bestie nên dùng kỹ năng này.\\n"); }}><FileText /> Tạo kỹ năng cục bộ</Button>
              </div>
              <Textarea value={draftContent} onChange={(event) => setDraftContent(event.target.value)} rows={18} placeholder="# Kỹ năng\\n\\nHướng dẫn..." data-skill-content />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={loading || !draftName.trim() || !draftContent.trim()} data-skill-action="save"><Save /> Lưu kỹ năng cục bộ</Button>
                {selectedLibraryItem ? <Button type="button" variant="outline" disabled={loading || !selectedLibraryItem.skill.installable} onClick={() => void installLibrarySkill(selectedLibraryItem.skill)} data-skill-action="install"><Download /> Cài bản xem trước</Button> : null}
              </div>
            </form>
            {selectedSkill ? <SkillDetails skill={selectedSkill} /> : null}
            {selectedLibraryItem ? <LibraryDetails item={selectedLibraryItem.skill} diff={selectedDiff} /> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function SkillsPanelError({ error }: { error: unknown }): ReactElement {
  return <SkillsError message={formatError(error)} />;
}

function LibraryList({ library, loading, items, onReload, onOpen, onInstall, onTest, onClearCache }: { library: SkillLibrarySummary | null; loading: boolean; items: SkillLibraryItem[]; onReload: () => Promise<void>; onOpen: (item: SkillLibraryItem) => Promise<void>; onInstall: (item: SkillLibraryItem) => Promise<void>; onTest: () => Promise<void>; onClearCache: () => Promise<void> }): ReactElement {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void onReload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Tải thư viện</Button>
        <Button variant="outline" onClick={() => void onTest()} disabled={loading}><ShieldCheck /> Kiểm tra từ xa</Button>
        <Button variant="outline" onClick={() => void onClearCache()} disabled={loading}><RotateCcw /> Xoá bộ nhớ đệm</Button>
      </div>
      {library ? <div className="rounded-2xl border border-white/10 bg-card/60 p-3 text-sm"><p className="font-semibold">{library.registry.activeSource.name}</p><p className="mt-1 text-muted-foreground">{library.installedCount}/{library.count} ?? c?i / danh m?c {library.registry.validation.ok ? "valid" : "có vấn đề"}</p></div> : null}
      {items.length ? items.map((item) => <LibrarySkillRow key={`${item.sourceId}:${item.name}`} item={item} loading={loading} onOpen={onOpen} onInstall={onInstall} />) : <EmptyText>{library ? "Không có kỹ năng nào khớp tìm kiếm." : "Tải thư viện để xem các kỹ năng có thể cài."}</EmptyText>}
    </div>
  );
}

function InstalledSkillRow({ skill, loading, onOpen, onToggle, onDelete, onRollback }: { skill: Skill; loading: boolean; onOpen: (name: string) => Promise<void>; onToggle: (enabled: boolean) => Promise<void>; onDelete: () => Promise<void>; onRollback: () => Promise<void> }): ReactElement {
  return (
    <div className="skill-row rounded-2xl border border-white/10 bg-card/60 p-4 text-sm" data-skill-row={skill.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-semibold">{skill.name}</p><p className="mt-1 text-muted-foreground">{skill.preview || skill.path}</p></div>
        <div className="flex flex-wrap gap-2"><Badge variant={skill.enabled ? "secondary" : "outline"}>{skill.enabled ? "đã bật" : "đã tắt"}</Badge>{skill.localChanges ? <Badge variant="destructive">đã sửa cục bộ</Badge> : null}</div>
      </div>
      <Separator className="my-3" />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{formatBytes(skill.bytes)} / {skill.manifest?.source ?? "cục bộ"}</span>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void onOpen(skill.name)} disabled={loading} data-skill-action="open">Mở</Button>
          <Button size="sm" variant="outline" onClick={() => void onToggle(!skill.enabled)} disabled={loading} data-skill-action="toggle">{skill.enabled ? "Tắt" : "Bật"}</Button>
          <Button size="sm" variant="outline" onClick={() => void onRollback()} disabled={loading || !skill.rollbackAvailable} data-skill-action="rollback"><RotateCcw /> Khôi phục</Button>
          <Button size="sm" variant="outline" onClick={() => void onDelete()} disabled={loading} data-skill-action="delete"><Trash2 /> Xoá</Button>
        </div>
      </div>
    </div>
  );
}

function LibrarySkillRow({ item, loading, onOpen, onInstall }: { item: SkillLibraryItem; loading: boolean; onOpen: (item: SkillLibraryItem) => Promise<void>; onInstall: (item: SkillLibraryItem) => Promise<void> }): ReactElement {
  return (
    <div className="skill-row rounded-2xl border border-white/10 bg-card/60 p-4 text-sm" data-skill-library-row={item.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-semibold">{item.title}</p><p className="mt-1 text-muted-foreground">{item.description}</p></div>
        <div className="flex flex-wrap gap-2"><Badge variant="outline">{item.category}</Badge><Badge variant={item.risk === "high" ? "destructive" : item.risk === "medium" ? "secondary" : "outline"}>{formatSkillRisk(item.risk)}</Badge>{item.updateAvailable ? <Badge variant="secondary">cập nhật</Badge> : null}</div>
      </div>
      <Separator className="my-3" />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{item.sourceName} / {item.version} / {formatSkillTrust(item.trust)} / {formatVerificationStatus(item.verificationStatus)}</span>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void onOpen(item)} disabled={loading} data-skill-action="preview">Xem trước</Button><Button size="sm" onClick={() => void onInstall(item)} disabled={loading || !item.installable} data-skill-action="install"><Download /> {item.installed ? "Cập nhật" : "Cài đặt"}</Button></div>
      </div>
      {item.installBlockedReason ? <p className="mt-2 text-xs text-destructive">{item.installBlockedReason}</p> : null}
    </div>
  );
}

function SkillDetails({ skill }: { skill: SkillItemResponse }): ReactElement {
  return <div className="mt-4 rounded-2xl border border-white/10 bg-card/60 p-4 text-sm"><p className="font-semibold">{skill.path}</p><p className="mt-1 text-muted-foreground">Nguồn: {skill.manifest?.source ?? "cục bộ"}{skill.manifest?.libraryVersion ? ` / ${skill.manifest.libraryVersion}` : ""}</p></div>;
}

function LibraryDetails({ item, diff }: { item: SkillLibraryItem; diff: SkillLibraryDiff | null }): ReactElement {
  return (
    <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap gap-2"><Badge variant="outline">{item.author}</Badge><Badge variant="outline">{item.sourceName}</Badge><Badge variant={item.localChanges ? "destructive" : "secondary"}>{item.localChanges ? "đã sửa cục bộ" : item.installed ? "đã cài" : "chưa cài"}</Badge></div>
      <p className="text-muted-foreground">{item.changelog || item.preview}</p>
      {item.permissions.length ? <p className="text-muted-foreground">Cần quyền: {item.permissions.join(", ")}</p> : null}
      {diff ? <div className="rounded-xl border border-white/10 bg-background/35 p-3"><p className="font-semibold">Xem trước thay đổi: +{diff.addedLines} / -{diff.removedLines}</p><pre className="no-scrollbar mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{diff.preview.slice(0, 30).map((line) => `${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "} ${line.text}`).join("\n")}</pre></div> : null}
    </div>
  );
}

function SkillsError({ message }: { message: string }): ReactElement {
  return <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Không tải được kỹ năng</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>;
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "warn" | "neutral" }): ReactElement {
  return <Card className="border-white/10 bg-background/35"><CardContent className="p-4"><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className={tone === "good" ? "mt-2 text-2xl font-semibold text-primary" : tone === "warn" ? "mt-2 text-2xl font-semibold text-accent" : "mt-2 text-2xl font-semibold"}>{value}</p></CardContent></Card>;
}

function EmptyText({ children }: { children: string }): ReactElement {
  return <p className="rounded-2xl border border-dashed border-white/10 bg-background/25 p-4 text-sm text-muted-foreground">{children}</p>;
}

function filterInstalled(skills: Skill[], query: string): Skill[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return skills;
  return skills.filter((skill) => [skill.name, skill.preview, skill.path, skill.manifest?.source, skill.manifest?.sourceName].some((value) => value?.toLowerCase().includes(normalized)));
}

function filterLibrary(skills: SkillLibraryItem[], query: string): SkillLibraryItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return skills;
  return skills.filter((skill) => [skill.name, skill.title, skill.description, skill.category, skill.author, skill.sourceName, skill.trust, skill.risk, ...skill.permissions].some((value) => value.toLowerCase().includes(normalized)));
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function formatSkillRisk(risk: string): string {
  if (risk === "high") return "rủi ro cao";
  if (risk === "medium") return "rủi ro vừa";
  if (risk === "low") return "rủi ro thấp";
  return risk;
}

function formatSkillTrust(trust: string): string {
  if (trust === "official") return "chính thức";
  if (trust === "verified") return "đã xác minh";
  if (trust === "community") return "cộng đồng";
  if (trust === "local") return "cục bộ";
  return trust;
}

function formatVerificationStatus(status: string): string {
  if (status === "verified") return "đã xác minh";
  if (status === "unverified") return "chưa xác minh";
  if (status === "missing") return "chưa có";
  if (status === "invalid") return "không hợp lệ";
  return status;
}
