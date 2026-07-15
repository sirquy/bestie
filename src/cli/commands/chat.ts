import { loadCharacter } from "../../character/character-loader.js";
import { loadSystemPrompt } from "../../character/prompt-loader.js";
import { runTerminalChat } from "../../chat/terminal-chat.js";
import { loadConfig } from "../../runtime/config.js";
import { UserFacingError } from "../../runtime/errors.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { maybePrintUpdateNotice } from "../update-notice.js";

export async function runChatCommand(argv: string[] = process.argv): Promise<void> {
  const paths = getRuntimePaths();
  void argv;

  try {
    const config = await loadConfig(paths);
    const character = await loadCharacter(paths);
    const systemPrompt = await loadSystemPrompt(paths);

    await maybePrintUpdateNotice({ paths });
    await runTerminalChat({ config, systemPrompt, paths, agentName: character.name, ownerName: config.agent.ownerName });
  } catch (error) {
    if (error instanceof UserFacingError) {
      console.log(error.message);
      return;
    }

    throw error;
  }
}