import { readFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import type { ActionPermissionRequest, ActionPermissionResult, PermissionApproval, PermissionApprover } from "../safety/permission-policy.js";

type AskLine = (question: string) => Promise<string>;

interface ApprovalQuestioner {
  ask: AskLine;
  close: () => void;
}

export async function createCliPermissionApprover(options: { writeLine?: (message: string) => void; questioner?: ApprovalQuestioner } = {}): Promise<PermissionApprover> {
  const writeLine = options.writeLine ?? console.log;
  const questioner = options.questioner ?? (await createApprovalQuestioner());

  return async (request, proposed) => {
    try {
      return await askPermissionApproval(request, proposed, questioner.ask, writeLine);
    } finally {
      questioner.close();
    }
  };
}

async function askPermissionApproval(request: ActionPermissionRequest, proposed: ActionPermissionResult, ask: AskLine, writeLine: (message: string) => void): Promise<PermissionApproval> {
  writeLine("Permission required");
  writeLine(`Action: ${request.action}`);
  writeLine(`Category: ${request.category}`);
  if (request.target) {
    writeLine(`Target: ${request.target}`);
  }
  writeLine(`Reason: ${request.reason ?? proposed.reason}`);

  const answer = (await ask("Allow this action once? Type yes to continue: ")).trim().toLowerCase();
  if (answer === "yes" || answer === "y") {
    return { approved: true, reason: "Approved once from CLI prompt." };
  }

  return { approved: false, reason: "Denied from CLI prompt." };
}

async function createApprovalQuestioner(): Promise<ApprovalQuestioner> {
  if (input.isTTY) {
    const rl = createInterface({ input, output });
    return { ask: (question) => rl.question(question), close: () => rl.close() };
  }

  const lines = readFileSync(0, "utf8").split(/\r?\n/);
  let index = 0;

  return {
    ask: async (question) => {
      output.write(question);
      return lines[index++] ?? "";
    },
    close: () => undefined,
  };
}