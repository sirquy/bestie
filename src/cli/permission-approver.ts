import { createCliQuestioner } from "./prompt.js";
import type { ActionPermissionRequest, ActionPermissionResult, PermissionApproval, PermissionApprover } from "../safety/permission-policy.js";

type AskLine = (question: string) => Promise<string>;

interface ApprovalQuestioner {
  ask: AskLine;
  confirm?: (question: string, defaultValue?: boolean) => Promise<boolean>;
  close: () => void;
}

export async function createCliPermissionApprover(options: { writeLine?: (message: string) => void; questioner?: ApprovalQuestioner } = {}): Promise<PermissionApprover> {
  const writeLine = options.writeLine ?? console.log;
  const questioner = options.questioner ?? (await createApprovalQuestioner());

  return async (request, proposed) => {
    try {
      return await askPermissionApproval(request, proposed, questioner, writeLine);
    } finally {
      questioner.close();
    }
  };
}

async function askPermissionApproval(request: ActionPermissionRequest, proposed: ActionPermissionResult, questioner: ApprovalQuestioner, writeLine: (message: string) => void): Promise<PermissionApproval> {
  writeLine("Permission required");
  writeLine(`Action: ${request.action}`);
  writeLine(`Category: ${request.category}`);
  if (request.target) {
    writeLine(`Target: ${request.target}`);
  }
  writeLine(`Reason: ${request.reason ?? proposed.reason}`);

  const approved = questioner.confirm
    ? await questioner.confirm("Allow this action once?", false)
    : ["yes", "y"].includes((await questioner.ask("Allow this action once? Type yes to continue: ")).trim().toLowerCase());
  if (approved) {
    return { approved: true, reason: "Approved once from CLI prompt." };
  }

  return { approved: false, reason: "Denied from CLI prompt." };
}

async function createApprovalQuestioner(): Promise<ApprovalQuestioner> {
  return createCliQuestioner();
}