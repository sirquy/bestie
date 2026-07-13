import { readFile } from "node:fs/promises";

import { EmptyPromptError, MissingCharacterFileError } from "../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../runtime/paths.js";

export async function loadSystemPrompt(paths: RuntimePaths = getRuntimePaths()): Promise<string> {
  let prompt: string;

  try {
    prompt = await readFile(paths.systemPromptPath, "utf8");
  } catch {
    throw new MissingCharacterFileError(paths.systemPromptPath);
  }

  if (prompt.trim().length === 0) {
    throw new EmptyPromptError(paths.systemPromptPath);
  }

  return prompt;
}