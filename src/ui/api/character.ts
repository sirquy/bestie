import { mkdir, readFile, writeFile } from "node:fs/promises";

import { validateCharacter } from "../../character/character-loader.js";
import { InvalidConfigError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

export interface UiCharacterSummary {
  ok: boolean;
  character: UiCharacterFile;
  prompt: UiPromptFile;
}

export interface UiCharacterFile {
  exists: boolean;
  path: string;
  text?: string;
  parsed?: {
    name: string;
    ownerName: string;
    language: string;
    tone: {
      roastLevel: number;
      warmthLevel: number;
      bluntnessLevel: number;
      chaosLevel: number;
    };
  };
  error?: string;
}

export interface UiPromptFile {
  exists: boolean;
  path: string;
  text?: string;
  empty?: boolean;
  error?: string;
}

export interface UpdateUiCharacterOptions {
  characterText?: string;
  promptText?: string;
  paths?: RuntimePaths;
}

export async function getUiCharacterSummary(paths: RuntimePaths = getRuntimePaths()): Promise<UiCharacterSummary> {
  return {
    ok: true,
    character: await readCharacterFile(paths),
    prompt: await readPromptFile(paths),
  };
}

export async function updateUiCharacter(options: UpdateUiCharacterOptions): Promise<UiCharacterSummary> {
  const paths = options.paths ?? getRuntimePaths();
  if (options.characterText === undefined && options.promptText === undefined) {
    throw new Error("Missing characterText or promptText.");
  }

  await mkdir(paths.appDir, { recursive: true });
  if (options.characterText !== undefined) {
    const parsed = parseCharacterText(options.characterText);
    validateCharacter(parsed);
    await writeFile(paths.characterPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  }
  if (options.promptText !== undefined) {
    if (options.promptText.trim().length === 0) {
      throw new Error("system-prompt.md cannot be empty.");
    }
    await writeFile(paths.systemPromptPath, options.promptText, { mode: 0o600 });
  }

  return getUiCharacterSummary(paths);
}

async function readCharacterFile(paths: RuntimePaths): Promise<UiCharacterFile> {
  try {
    const text = await readFile(paths.characterPath, "utf8");
    const parsed = validateCharacter(parseCharacterText(text));
    return {
      exists: true,
      path: paths.characterPath,
      text,
      parsed: {
        name: parsed.name,
        ownerName: parsed.ownerName,
        language: parsed.language,
        tone: parsed.tone,
      },
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { exists: false, path: paths.characterPath };
    }

    return { exists: true, path: paths.characterPath, error: error instanceof Error ? error.message : "Invalid character file." };
  }
}

async function readPromptFile(paths: RuntimePaths): Promise<UiPromptFile> {
  try {
    const text = await readFile(paths.systemPromptPath, "utf8");
    return { exists: true, path: paths.systemPromptPath, text, empty: text.trim().length === 0 };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { exists: false, path: paths.systemPromptPath };
    }

    return { exists: true, path: paths.systemPromptPath, error: error instanceof Error ? error.message : "Could not read prompt file." };
  }
}

function parseCharacterText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidConfigError("character.json is not valid JSON.");
  }
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}