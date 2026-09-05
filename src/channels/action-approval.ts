import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import type { RuntimePaths } from "../runtime/paths.js";
import type { ActionPermissionRequest, ActionPermissionResult, PermissionApprover } from "../safety/permission-policy.js";

export interface ChannelActionApprovalOptions {
  paths: RuntimePaths;
  channel: string;
  userId: string;
  ttlMs: number;
  send: (approvalId: number, request: ActionPermissionRequest, proposed: ActionPermissionResult) => Promise<void>;
  pendingReason: (approvalId: number) => string;
}

export function createChannelActionPermissionApprover(options: ChannelActionApprovalOptions): PermissionApprover {
  return async (request: ActionPermissionRequest, proposed: ActionPermissionResult) => {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const approval = store.addPendingActionApproval({
        channel: options.channel,
        userId: options.userId,
        category: request.category,
        action: request.action,
        target: request.target,
        reason: request.reason,
        proposedReason: proposed.reason,
        payloadJson: request.payloadJson,
        ttlMs: options.ttlMs,
      });
      await options.send(approval.id, request, proposed);
      return { approved: false, reason: options.pendingReason(approval.id) };
    } finally {
      store.close();
    }
  };
}
