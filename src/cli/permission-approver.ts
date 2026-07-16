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
  writeLine("Cần quyền xác nhận");
  writeLine(`Hành động: ${request.action}`);
  writeLine(`Nhóm: ${request.category}`);
  if (request.target) {
    writeLine(`Đích: ${request.target}`);
  }
  writeLine(`Lý do: ${request.reason ?? proposed.reason}`);

  const approved = questioner.confirm
    ? await questioner.confirm("Cho phép hành động này một lần?", false)
    : ["yes", "y", "co", "có"].includes((await questioner.ask("Cho phép hành động này một lần? Gõ yes hoặc có để tiếp tục: ")).trim().toLowerCase());
  if (approved) {
    return { approved: true, reason: "Đã duyệt một lần từ CLI prompt." };
  }

  return { approved: false, reason: "Đã từ chối từ CLI prompt." };
}

async function createApprovalQuestioner(): Promise<ApprovalQuestioner> {
  return createCliQuestioner();
}