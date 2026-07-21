import { access } from "node:fs/promises";

import { SqliteMemoryStore, type PendingActionApproval } from "../../memory/sqlite-store.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

const APPROVAL_CHANNELS = ["telegram", "zalo"] as const;

export interface UiApprovalsSummary {
  ok: true;
  databaseExists: boolean;
  count: number;
  approvals: UiPendingActionApproval[];
}

export interface UiApprovalActionOptions {
  action: "approve" | "deny";
  id: number;
  confirm: boolean;
  paths?: RuntimePaths;
}

export interface UiApprovalActionResult extends UiApprovalsSummary {
  action: UiApprovalActionOptions["action"];
  approval: UiPendingActionApproval;
}

interface UiPendingActionApproval {
  id: number;
  channel: string;
  userId?: string;
  category: string;
  action: string;
  target?: string;
  reason?: string;
  proposedReason?: string;
  status: PendingActionApproval["status"];
  createdAt: string;
  expiresAt: string;
}

export async function getUiApprovalsSummary(paths: RuntimePaths = getRuntimePaths()): Promise<UiApprovalsSummary> {
  const databaseExists = await pathExists(paths.memoryDbPath);
  if (!databaseExists) {
    return { ok: true, databaseExists: false, count: 0, approvals: [] };
  }

  const store = await SqliteMemoryStore.open(paths);
  try {
    const approvals = APPROVAL_CHANNELS.flatMap((channel) => store.listPendingActionApprovals(channel, undefined, 20));
    approvals.sort((left, right) => right.id - left.id);
    const limited = approvals.slice(0, 20).map(toUiApproval);
    return { ok: true, databaseExists: true, count: limited.length, approvals: limited };
  } finally {
    store.close();
  }
}

export async function runUiApprovalAction(options: UiApprovalActionOptions): Promise<UiApprovalActionResult> {
  if (!options.confirm) {
    throw new Error("Approval actions require confirm=true.");
  }
  if (!Number.isInteger(options.id) || options.id <= 0) {
    throw new Error("Approval action requires numeric id.");
  }

  const paths = options.paths ?? getRuntimePaths();
  const store = await SqliteMemoryStore.open(paths);
  try {
    const approval = options.action === "approve" ? store.approvePendingActionApproval(options.id) : store.denyPendingActionApproval(options.id);
    if (!approval) {
      throw new Error(`Pending approval not found: ${options.id}`);
    }

    return {
      ...(await getUiApprovalsSummary(paths)),
      action: options.action,
      approval: toUiApproval(approval),
    };
  } finally {
    store.close();
  }
}

function toUiApproval(approval: PendingActionApproval): UiPendingActionApproval {
  return {
    id: approval.id,
    channel: approval.channel,
    ...(approval.userId ? { userId: approval.userId } : {}),
    category: approval.category,
    action: approval.action,
    ...(approval.target ? { target: approval.target } : {}),
    ...(approval.reason ? { reason: approval.reason } : {}),
    ...(approval.proposedReason ? { proposedReason: approval.proposedReason } : {}),
    status: approval.status,
    createdAt: approval.createdAt,
    expiresAt: approval.expiresAt,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}