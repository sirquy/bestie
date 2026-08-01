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
      `Skill ${draftName} saved.`,
    );
    setSelectedSkill(null);
  }

  async function confirmSkillAction(endpoint: string, body: Record<string, unknown>, confirmText: string, success: string): Promise<void> {
    if (!window.confirm(confirmText)) return;
    await runSummaryAction(() => fetchJson<SkillsSummary>(endpoint, { method: "POST", body: JSON.stringify({ ...body, confirm: true }) }), success);
    if (body.name === selectedSkill?.name) setSelectedSkill(null);
  }

  async function installLibrarySkill(item: SkillLibraryItem): Promise<void> {
    await confirmSkillAction("/api/skills/install", { name: item.name, sourceId: item.sourceId }, `Install skill ${item.name}?`, `Skill ${item.name} installed.`);
    await loadLibrary();
  }

  async function testRemoteRegistry(): Promise<void> {
    if (!window.confirm("Test remote skill registry? This may perform a network request.")) return;
    setActionError(null);
    setActionMessage(null);
    setLibraryLoading(true);
    try {
      const result = await fetchJson<SkillRemoteRegistryTestResult>("/api/skills/registry/test", { method: "POST", body: JSON.stringify({ confirm: true }) });
      setActionMessage(result.error ? `Remote registry responded with error: ${result.error}` : result.configured ? "Remote registry test finished." : "No remote registry configured.");
      await loadLibrary();
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      setLibraryLoading(false);
    }
  }

  async function clearRegistryCache(): Promise<void> {
    if (!window.confirm("Clear remote skill registry cache?")) return;
    setActionError(null);
    setActionMessage(null);
    setLibraryLoading(true);
    try {
      setLibrary(await fetchJson<SkillLibrarySummary>("/api/skills/registry/cache/clear", { method: "POST", body: JSON.stringify({ confirm: true }) }));
      setActionMessage("Remote registry cache cleared.");
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
        <AlertTitle>Skills are loading</AlertTitle>
        <AlertDescription>Reading installed skills from the local runtime directory.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      {actionError ? <SkillsError message={actionError} /> : null}
      {actionMessage ? <Alert className="border-primary/40 bg-primary/10"><Check className="size-4" /><AlertTitle>Skills updated</AlertTitle><AlertDescription>{actionMessage}</AlertDescription></Alert> : null}

      <div className="grid gap-3 md:grid-cols-4" data-skills-summary>
        <Metric label="Installed" value={String(data.count)} tone="good" />
        <Metric label="Enabled" value={String(data.skills.filter((skill) => skill.enabled).length)} />
        <Metric label="Local changes" value={String(data.skills.filter((skill) => skill.localChanges).length)} tone={data.skills.some((skill) => skill.localChanges) ? "warn" : "neutral"} />
        <Metric label="Library" value={library ? String(library.count) : "not loaded"} />
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><BookOpen className="size-5" /> Skills workspace</CardTitle>
            <CardDescription>{data.skillsDir}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant={mode === "installed" ? "default" : "outline"} onClick={() => setMode("installed")}>Installed</Button>
            <Button variant={mode === "library" ? "default" : "outline"} onClick={() => { setMode("library"); if (!library && !libraryLoading) void loadLibrary(); }}>Library</Button>
            <Button variant="outline" onClick={() => void reloadInstalled()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Reload</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills by name, preview, category, or permissions" />
            <Button type="button" variant="outline" onClick={() => setQuery("")}><Search /> Clear</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="border-white/10 bg-background/35">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">{mode === "library" ? <Library className="size-5" /> : <FileText className="size-5" />} {mode === "library" ? "Library catalog" : "Installed skills"}</CardTitle>
            <CardDescription>{mode === "library" ? "Install official/verified skills with explicit confirmation." : "Open a skill to inspect or edit its SKILL.md content."}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {mode === "library" ? (
              <LibraryList library={library} loading={libraryLoading} items={filteredLibrary} onReload={loadLibrary} onOpen={openLibraryItem} onInstall={installLibrarySkill} onTest={testRemoteRegistry} onClearCache={clearRegistryCache} />
            ) : filteredInstalled.length ? (
              filteredInstalled.map((skill) => <InstalledSkillRow key={skill.name} skill={skill} loading={loading} onOpen={openSkill} onToggle={(enabled) => confirmSkillAction("/api/skills/toggle", { name: skill.name, enabled }, `${enabled ? "Enable" : "Disable"} skill ${skill.name}?`, `Skill ${skill.name} ${enabled ? "enabled" : "disabled"}.`)} onDelete={() => confirmSkillAction("/api/skills/delete", { name: skill.name }, `Delete skill ${skill.name}? It will be archived before removal.`, `Skill ${skill.name} deleted.`)} onRollback={() => confirmSkillAction("/api/skills/rollback", { name: skill.name }, `Rollback skill ${skill.name} to latest backup?`, `Skill ${skill.name} rolled back.`)} />)
            ) : <EmptyText>No installed skills found.</EmptyText>}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-background/35" data-skill-editor>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Code2 className="size-5" /> Skill editor</CardTitle>
            <CardDescription>{selectedLibraryItem ? "Preview library content before installing." : "Edit local skill content. Secrets should not be stored in skills."}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={(event) => void saveDraft(event)}>
              <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
                <div className="grid gap-2">
                  <Label htmlFor="skill-name">Skill name</Label>
                  <Input id="skill-name" value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="my-skill" data-skill-name-input />
                </div>
                <Button type="button" variant="outline" onClick={() => { setSelectedSkill(null); setSelectedLibraryItem(null); setSelectedDiff(null); setDraftName("new-skill"); setDraftContent("# New Skill\n\nDescribe when and how Bestie should use this skill.\n"); }}><FileText /> New local</Button>
              </div>
              <Textarea value={draftContent} onChange={(event) => setDraftContent(event.target.value)} rows={18} placeholder="# Skill\n\nInstructions..." data-skill-content />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={loading || !draftName.trim() || !draftContent.trim()} data-skill-action="save"><Save /> Save local skill</Button>
                {selectedLibraryItem ? <Button type="button" variant="outline" disabled={loading || !selectedLibraryItem.skill.installable} onClick={() => void installLibrarySkill(selectedLibraryItem.skill)} data-skill-action="install"><Download /> Install previewed</Button> : null}
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
        <Button variant="outline" onClick={() => void onReload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Load library</Button>
        <Button variant="outline" onClick={() => void onTest()} disabled={loading}><ShieldCheck /> Test remote</Button>
        <Button variant="outline" onClick={() => void onClearCache()} disabled={loading}><RotateCcw /> Clear cache</Button>
      </div>
      {library ? <div className="rounded-2xl border border-white/10 bg-card/60 p-3 text-sm"><p className="font-semibold">{library.registry.activeSource.name}</p><p className="mt-1 text-muted-foreground">{library.installedCount}/{library.count} installed / registry {library.registry.validation.ok ? "valid" : "has issues"}</p></div> : null}
      {items.length ? items.map((item) => <LibrarySkillRow key={`${item.sourceId}:${item.name}`} item={item} loading={loading} onOpen={onOpen} onInstall={onInstall} />) : <EmptyText>{library ? "No library skills match this search." : "Load the library to browse installable skills."}</EmptyText>}
    </div>
  );
}

function InstalledSkillRow({ skill, loading, onOpen, onToggle, onDelete, onRollback }: { skill: Skill; loading: boolean; onOpen: (name: string) => Promise<void>; onToggle: (enabled: boolean) => Promise<void>; onDelete: () => Promise<void>; onRollback: () => Promise<void> }): ReactElement {
  return (
    <div className="skill-row rounded-2xl border border-white/10 bg-card/60 p-4 text-sm" data-skill-row={skill.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-semibold">{skill.name}</p><p className="mt-1 text-muted-foreground">{skill.preview || skill.path}</p></div>
        <div className="flex flex-wrap gap-2"><Badge variant={skill.enabled ? "secondary" : "outline"}>{skill.enabled ? "enabled" : "disabled"}</Badge>{skill.localChanges ? <Badge variant="destructive">local changes</Badge> : null}</div>
      </div>
      <Separator className="my-3" />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{formatBytes(skill.bytes)} / {skill.manifest?.source ?? "local"}</span>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void onOpen(skill.name)} disabled={loading} data-skill-action="open">Open</Button>
          <Button size="sm" variant="outline" onClick={() => void onToggle(!skill.enabled)} disabled={loading} data-skill-action="toggle">{skill.enabled ? "Disable" : "Enable"}</Button>
          <Button size="sm" variant="outline" onClick={() => void onRollback()} disabled={loading || !skill.rollbackAvailable} data-skill-action="rollback"><RotateCcw /> Rollback</Button>
          <Button size="sm" variant="outline" onClick={() => void onDelete()} disabled={loading} data-skill-action="delete"><Trash2 /> Delete</Button>
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
        <div className="flex flex-wrap gap-2"><Badge variant="outline">{item.category}</Badge><Badge variant={item.risk === "high" ? "destructive" : item.risk === "medium" ? "secondary" : "outline"}>{item.risk}</Badge>{item.updateAvailable ? <Badge variant="secondary">update</Badge> : null}</div>
      </div>
      <Separator className="my-3" />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{item.sourceName} / {item.version} / {item.trust} / {item.verificationStatus}</span>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void onOpen(item)} disabled={loading} data-skill-action="preview">Preview</Button><Button size="sm" onClick={() => void onInstall(item)} disabled={loading || !item.installable} data-skill-action="install"><Download /> {item.installed ? "Update" : "Install"}</Button></div>
      </div>
      {item.installBlockedReason ? <p className="mt-2 text-xs text-destructive">{item.installBlockedReason}</p> : null}
    </div>
  );
}

function SkillDetails({ skill }: { skill: SkillItemResponse }): ReactElement {
  return <div className="mt-4 rounded-2xl border border-white/10 bg-card/60 p-4 text-sm"><p className="font-semibold">{skill.path}</p><p className="mt-1 text-muted-foreground">Manifest: {skill.manifest?.source ?? "local"}{skill.manifest?.libraryVersion ? ` / ${skill.manifest.libraryVersion}` : ""}</p></div>;
}

function LibraryDetails({ item, diff }: { item: SkillLibraryItem; diff: SkillLibraryDiff | null }): ReactElement {
  return (
    <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
      <div className="flex flex-wrap gap-2"><Badge variant="outline">{item.author}</Badge><Badge variant="outline">{item.sourceName}</Badge><Badge variant={item.localChanges ? "destructive" : "secondary"}>{item.localChanges ? "local changes" : item.installed ? "installed" : "not installed"}</Badge></div>
      <p className="text-muted-foreground">{item.changelog || item.preview}</p>
      {item.permissions.length ? <p className="text-muted-foreground">Permissions: {item.permissions.join(", ")}</p> : null}
      {diff ? <div className="rounded-xl border border-white/10 bg-background/35 p-3"><p className="font-semibold">Diff preview: +{diff.addedLines} / -{diff.removedLines}</p><pre className="no-scrollbar mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{diff.preview.slice(0, 30).map((line) => `${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "} ${line.text}`).join("\n")}</pre></div> : null}
    </div>
  );
}

function SkillsError({ message }: { message: string }): ReactElement {
  return <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Skills request failed</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>;
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
