import { mkdir, writeFile } from "node:fs/promises";

import type { RuntimePaths } from "../runtime/paths.js";
import type { CharacterConfig } from "./prompt-generator.js";

export async function writeCharacterFiles(
  character: CharacterConfig,
  systemPrompt: string,
  paths: RuntimePaths,
): Promise<void> {
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.characterPath, `${JSON.stringify(character, null, 2)}\n`, { mode: 0o600 });
  await writeFile(paths.systemPromptPath, systemPrompt, { mode: 0o600 });
}
