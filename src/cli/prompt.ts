import { readFileSync } from "node:fs";
import { stdin as inputStream, stdout as outputStream } from "node:process";

import { confirm, input, password, select } from "@inquirer/prompts";

type AskLine = (question: string) => Promise<string>;

export interface CliQuestioner {
  ask: AskLine;
  askHidden: AskLine;
  select: <T extends string>(question: string, choices: Array<{ name: string; value: T; description?: string }>) => Promise<T>;
  confirm: (question: string, defaultValue?: boolean) => Promise<boolean>;
  close: () => void;
}

export interface EofAwareCliQuestioner extends Omit<CliQuestioner, "ask" | "askHidden"> {
  ask: (question: string) => Promise<string | undefined>;
  askHidden: (question: string) => Promise<string | undefined>;
}

interface CliQuestionerOptions {
  echoAnswer?: boolean;
  inputText?: string;
  returnUndefinedOnInputEnd?: boolean;
  write?: (chunk: string) => void;
}

export function createCliQuestioner(options: CliQuestionerOptions & { returnUndefinedOnInputEnd: true }): EofAwareCliQuestioner;
export function createCliQuestioner(options?: CliQuestionerOptions): CliQuestioner;
export function createCliQuestioner(options: CliQuestionerOptions = {}): CliQuestioner | EofAwareCliQuestioner {
  if (options.inputText !== undefined || !inputStream.isTTY) {
    const lines = (options.inputText ?? readFileSync(0, "utf8")).split(/\r?\n/);
    let index = 0;
    const write = options.write ?? ((chunk: string) => outputStream.write(chunk));

    const readLine = async (question: string): Promise<string | undefined> => {
      const answer = lines[index++] ?? "";
      if (answer === undefined || (answer === "" && options.returnUndefinedOnInputEnd && index >= lines.length)) {
        return undefined;
      }
      write(options.echoAnswer ? `${question}${answer}\n` : question);
      if (!options.echoAnswer) {
        write("\n");
      }
      return answer;
    };

    return {
      ask: readLine,
      askHidden: readLine,
      select: async (question, choices) => {
        const answer = (await readLine(question))?.trim() ?? "";
        const numeric = Number.parseInt(answer, 10);
        if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) {
          return choices[numeric - 1].value;
        }
        return choices.find((choice) => choice.value === answer || choice.name === answer)?.value ?? choices[0].value;
      },
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
    select: (question, choices) => select({ message: question, choices }),
    confirm: (question, defaultValue = false) => confirm({ message: question, default: defaultValue }),
    close: () => undefined,
  };
}