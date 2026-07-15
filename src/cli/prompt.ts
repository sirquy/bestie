import { readFileSync } from "node:fs";
import { stdin as inputStream, stdout as outputStream } from "node:process";

import { confirm, input, password } from "@inquirer/prompts";

type AskLine = (question: string) => Promise<string>;

export interface CliQuestioner {
  ask: AskLine;
  askHidden: AskLine;
  confirm: (question: string, defaultValue?: boolean) => Promise<boolean>;
  close: () => void;
}

export function createCliQuestioner(): CliQuestioner {
  if (!inputStream.isTTY) {
    const lines = readFileSync(0, "utf8").split(/\r?\n/);
    let index = 0;

    const readLine = async (question: string): Promise<string> => {
      outputStream.write(question);
      const answer = lines[index++] ?? "";
      outputStream.write("\n");
      return answer;
    };

    return {
      ask: readLine,
      askHidden: readLine,
      confirm: async (question, defaultValue = false) => {
        const answer = (await readLine(question)).trim().toLowerCase();
        if (!answer) {
          return defaultValue;
        }
        return answer === "yes" || answer === "y" || answer === "true";
      },
      close: () => undefined,
    };
  }

  return {
    ask: (question) => input({ message: question }),
    askHidden: (question) => password({ message: question, mask: "*" }),
    confirm: (question, defaultValue = false) => confirm({ message: question, default: defaultValue }),
    close: () => undefined,
  };
}