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

export interface EofAwareCliQuestioner extends Omit<CliQuestioner, "ask" | "askHidden"> {
  ask: (question: string) => Promise<string | undefined>;
  askHidden: (question: string) => Promise<string | undefined>;
}

interface CliQuestionerOptions {
  echoAnswer?: boolean;
  returnUndefinedOnInputEnd?: boolean;
}

export function createCliQuestioner(options: CliQuestionerOptions & { returnUndefinedOnInputEnd: true }): EofAwareCliQuestioner;
export function createCliQuestioner(options?: CliQuestionerOptions): CliQuestioner;
export function createCliQuestioner(options: CliQuestionerOptions = {}): CliQuestioner | EofAwareCliQuestioner {
  if (!inputStream.isTTY) {
    const lines = readFileSync(0, "utf8").split(/\r?\n/);
    let index = 0;

    const readLine = async (question: string): Promise<string | undefined> => {
      const answer = lines[index++];
      if (answer === undefined || (answer === "" && options.returnUndefinedOnInputEnd && index > lines.length)) {
        return undefined;
      }
      outputStream.write(options.echoAnswer ? `${question}${answer}\n` : question);
      if (!options.echoAnswer) {
        outputStream.write("\n");
      }
      return answer;
    };

    return {
      ask: readLine,
      askHidden: readLine,
      confirm: async (question, defaultValue = false) => {
        const answer = (await readLine(question))?.trim().toLowerCase() ?? "";
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