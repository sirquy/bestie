import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Bot, FileJson2, RefreshCw, Save, SlidersHorizontal, Sparkles, WandSparkles } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, formatError } from "@/lib/api";
import { confirmDialog } from "@/lib/dialogs";
import type { CharacterSummary, CharacterTone } from "./types";

interface CharacterPanelProps {
  data?: CharacterSummary;
  loading: boolean;
  onData: (data: CharacterSummary) => void;
  onLoading: (loading: boolean) => void;
}

type CharacterDraft = Record<string, unknown> & {
  name?: string;
  ownerName?: string;
  language?: string;
  tone?: Partial<CharacterTone>;
};

const defaultTone: CharacterTone = { roastLevel: 5, warmthLevel: 7, bluntnessLevel: 7, chaosLevel: 4 };

export function CharacterPanel({ data, loading, onData, onLoading }: CharacterPanelProps): ReactElement {
  const [characterText, setCharacterText] = useState("");
  const [promptText, setPromptText] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setCharacterText(data.character.text ?? "");
    setPromptText(data.prompt.text ?? "");
  }, [data]);

  const draft = useMemo(() => parseDraft(characterText), [characterText]);
  const tone = normalizeTone(draft?.tone);

  async function runAction(action: () => Promise<CharacterSummary>, success?: string): Promise<void> {
    setActionError(null);
    setSaveMessage(null);
    onLoading(true);
    try {
      const nextData = await action();
      onData(nextData);
      if (success) setSaveMessage(success);
    } catch (error: unknown) {
      setActionError(formatError(error));
    } finally {
      onLoading(false);
    }
  }

  async function reload(): Promise<void> {
    await runAction(() => fetchJson<CharacterSummary>("/api/character"));
  }

  async function save(): Promise<void> {
    if (!await confirmDialog("Save Bestie's personality and conversation guide?")) return;
    await runAction(() => fetchJson<CharacterSummary>("/api/character", { method: "PUT", body: JSON.stringify({ characterText, promptText }) }), "Bestie's personality was saved.");
  }

  function updateDraftField(key: "name" | "ownerName" | "language", value: string): void {
    const nextDraft: CharacterDraft = draft ?? {};
    nextDraft[key] = value;
    setCharacterText(`${JSON.stringify(nextDraft, null, 2)}\n`);
  }

  function updateToneField(key: keyof CharacterTone, value: number): void {
    const nextDraft: CharacterDraft = draft ?? {};
    nextDraft.tone = { ...normalizeTone(nextDraft.tone), [key]: value };
    setCharacterText(`${JSON.stringify(nextDraft, null, 2)}\n`);
  }

  function syncPromptDraft(): void {
    const nextDraft = draft ?? {};
    const name = stringValue(nextDraft.name) || data?.character.parsed?.name || "Bestie";
    const ownerName = stringValue(nextDraft.ownerName) || data?.character.parsed?.ownerName || "Boss";
    const language = stringValue(nextDraft.language) || data?.character.parsed?.language || "vi";
    setPromptText(buildPromptDraft(name, ownerName, language, tone));
  }

  function insertSafetyGuardrails(): void {
    const guardrails = "\n\n## Safety Guardrails\n\n- Do not present as human, conscious, a therapist replacement, or a romantic companion.\n- Do not expose secrets, raw .env values, API keys, tokens, or unsafe private data.\n- Drop jokes when the user is vulnerable, unsafe, or asking for serious help.\n- Keep playful bluntness warm; never be cruel, humiliating, hateful, or sexually explicit.\n";
    if (promptText.includes("## Safety Guardrails")) return;
    setPromptText(`${promptText.trimEnd()}${guardrails}`);
  }

  if (!data) {
    return (
      <Alert className="border-accent/40 bg-accent/10">
        <Bot className="size-4" />
        <AlertTitle>Character Studio is loading</AlertTitle>
        <AlertDescription>Loading Bestie's personality settings.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      {actionError ? <CharacterError message={actionError} /> : null}
      {saveMessage ? <Alert className="border-primary/40 bg-primary/10"><Sparkles className="size-4" /><AlertTitle>Saved</AlertTitle><AlertDescription>{saveMessage}</AlertDescription></Alert> : null}

      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="border-white/10 bg-background/35">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Bot className="size-5" /> Character Studio</CardTitle>
              <CardDescription>Adjust how Bestie sounds and behaves.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Reload</Button>
              <Button onClick={() => void save()} disabled={loading || !draft || promptText.trim().length === 0}><Save /> Save</Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div id="character-live-preview" className="rounded-2xl border border-white/10 bg-card/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-2xl font-semibold">{stringValue(draft?.name) || data.character.parsed?.name || "Bestie"}</p>
                  <p className="text-sm text-muted-foreground">Owner: {stringValue(draft?.ownerName) || data.character.parsed?.ownerName || "-"}</p>
                </div>
                <Badge variant={draft ? "secondary" : "destructive"}>{draft ? stringValue(draft.language) || data.character.parsed?.language || "vi" : "needs fixing"}</Badge>
              </div>
              <Separator className="my-4" />
              <div className="grid gap-2 text-sm">
                <FileStatus label="Personality file" exists={data.character.exists} path={data.character.path} error={data.character.error} />
                <FileStatus label="Conversation guide" exists={data.prompt.exists} path={data.prompt.path} error={data.prompt.error} />
              </div>
            </div>

            <form id="character-form" className="grid gap-3">
              <FormField label="Name"><Input name="name" value={stringValue(draft?.name)} onChange={(event) => updateDraftField("name", event.target.value)} /></FormField>
              <FormField label="Owner"><Input name="ownerName" value={stringValue(draft?.ownerName)} onChange={(event) => updateDraftField("ownerName", event.target.value)} /></FormField>
              <FormField label="Language"><Input name="language" value={stringValue(draft?.language)} onChange={(event) => updateDraftField("language", event.target.value)} /></FormField>
              <div className="grid gap-3 rounded-2xl border border-white/10 bg-card/60 p-4">
                <div className="flex items-center gap-2"><SlidersHorizontal className="size-4" /><p className="font-semibold">Tone Lab</p></div>
                {toneFields.map((field) => <ToneField key={field.key} label={field.label} name={field.key} value={tone[field.key]} onChange={(value) => updateToneField(field.key, value)} />)}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-background/35">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileJson2 className="size-5" /> Personality details</CardTitle>
            <CardDescription>Edit the structured personality settings. Bestie checks them before saving.</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea id="character-json" className="min-h-[38rem] font-mono text-xs" spellCheck={false} value={characterText} onChange={(event) => setCharacterText(event.target.value)} />
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/10 bg-background/35">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><WandSparkles className="size-5" /> Conversation instructions</CardTitle>
            <CardDescription>Edit `system-prompt.md`; empty prompts are rejected by the backend.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button id="character-sync-prompt" variant="outline" onClick={syncPromptDraft} type="button">Draft from character</Button>
            <Button id="character-insert-guardrails" variant="secondary" onClick={insertSafetyGuardrails} type="button">Insert guardrails</Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <Textarea id="character-prompt" className="min-h-[26rem] font-mono text-xs" spellCheck={false} value={promptText} onChange={(event) => setPromptText(event.target.value)} />
          <div id="character-prompt-outline" className="rounded-2xl border border-white/10 bg-card/60 p-4 text-sm">
            <p className="font-semibold">Prompt outline</p>
            <Separator className="my-3" />
            <p><span className="text-muted-foreground">Lines:</span> {promptText.split("\n").length}</p>
            <p><span className="text-muted-foreground">Characters:</span> {promptText.length}</p>
            <p><span className="text-muted-foreground">Guardrails:</span> {promptText.includes("Safety Guardrails") ? "present" : "not inserted"}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function CharacterPanelError({ error }: { error: unknown }): ReactElement {
  return <CharacterError message={formatError(error)} />;
}

function CharacterError({ message }: { message: string }): ReactElement {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertTitle>Character request failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function FileStatus({ label, exists, path, error }: { label: string; exists: boolean; path: string; error?: string }): ReactElement {
  return (
    <div className="grid gap-1 rounded-xl border border-white/10 bg-background/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{label}</p><Badge variant={error ? "destructive" : exists ? "secondary" : "outline"}>{error ? "error" : exists ? "exists" : "missing"}</Badge></div>
      <p className="break-all text-xs text-muted-foreground">{path}</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return <div className="grid gap-2"><Label>{label}</Label>{children}</div>;
}

function ToneField({ label, name, value, onChange }: { label: string; name: string; value: number; onChange: (value: number) => void }): ReactElement {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2"><Label>{label}</Label><Badge variant="outline">{value}</Badge></div>
      <Input name={name} type="range" min={0} max={10} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

const toneFields: Array<{ key: keyof CharacterTone; label: string }> = [
  { key: "roastLevel", label: "Roast" },
  { key: "warmthLevel", label: "Warmth" },
  { key: "bluntnessLevel", label: "Bluntness" },
  { key: "chaosLevel", label: "Chaos" },
];

function parseDraft(text: string): CharacterDraft | undefined {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as CharacterDraft : undefined;
  } catch {
    return undefined;
  }
}

function normalizeTone(value: unknown): CharacterTone {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<CharacterTone> : {};
  return {
    roastLevel: numberValue(record.roastLevel, defaultTone.roastLevel),
    warmthLevel: numberValue(record.warmthLevel, defaultTone.warmthLevel),
    bluntnessLevel: numberValue(record.bluntnessLevel, defaultTone.bluntnessLevel),
    chaosLevel: numberValue(record.chaosLevel, defaultTone.chaosLevel),
  };
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function buildPromptDraft(name: string, ownerName: string, language: string, tone: CharacterTone): string {
  return `You are ${name}, a local-first AI companion for ${ownerName}.\n\n## Core Voice\n\n- Default language: ${language}.\n- Warmth: ${tone.warmthLevel}/10.\n- Bluntness: ${tone.bluntnessLevel}/10.\n- Roast level: ${tone.roastLevel}/10.\n- Chaos: ${tone.chaosLevel}/10.\n\n## Behavior\n\nBe playful, direct, emotionally honest, and practical. Keep jokes warm, never cruel. Ask useful follow-up questions when context is missing.\n`;
}
