import { readFile } from "node:fs/promises";

import { InvalidConfigError, MissingCharacterFileError } from "../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../runtime/paths.js";
import type { CharacterConfig } from "./prompt-generator.js";

export async function loadCharacter(paths: RuntimePaths = getRuntimePaths()): Promise<CharacterConfig> {
  let characterText: string;

  try {
    characterText = await readFile(paths.characterPath, "utf8");
  } catch {
    throw new MissingCharacterFileError(paths.characterPath);
  }

  let parsedCharacter: unknown;
  try {
    parsedCharacter = JSON.parse(characterText);
  } catch {
    throw new InvalidConfigError("character.json is not valid JSON.");
  }

  return validateCharacter(parsedCharacter);
}

export function validateCharacter(character: unknown): CharacterConfig {
  if (!isRecord(character)) {
    throw new InvalidConfigError("character.json must contain an object.");
  }

  const tone = requireRecord(character.tone, "character.tone");
  const boundaries = requireRecord(character.boundaries, "character.boundaries");

  return {
    name: requireString(character.name, "character.name"),
    role: requireRole(character.role),
    language: requireCharacterLanguage(character.language),
    personality: requireStringArray(character.personality, "character.personality"),
    tone: {
      roastLevel: requireNumber(tone.roastLevel, "character.tone.roastLevel"),
      warmthLevel: requireNumber(tone.warmthLevel, "character.tone.warmthLevel"),
      bluntnessLevel: requireNumber(tone.bluntnessLevel, "character.tone.bluntnessLevel"),
      chaosLevel: requireNumber(tone.chaosLevel, "character.tone.chaosLevel"),
    },
    boundaries: {
      neverJokeAbout: requireStringArray(boundaries.neverJokeAbout, "character.boundaries.neverJokeAbout"),
      dropJokesWhen: requireStringArray(boundaries.dropJokesWhen, "character.boundaries.dropJokesWhen"),
    },
    ownerName: requireString(character.ownerName, "character.ownerName"),
  };
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InvalidConfigError(`${fieldName} must be an object.`);
  }

  return value;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidConfigError(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number") {
    throw new InvalidConfigError(`${fieldName} must be a number.`);
  }

  return value;
}

function requireStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new InvalidConfigError(`${fieldName} must be an array of strings.`);
  }

  return value;
}

function requireRole(value: unknown): CharacterConfig["role"] {
  if (value !== "AI best friend companion") {
    throw new InvalidConfigError("character.role must be AI best friend companion.");
  }

  return value;
}

function requireCharacterLanguage(value: unknown): CharacterConfig["language"] {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  throw new InvalidConfigError("character.language must be a non-empty string.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
