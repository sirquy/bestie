import { appendLog } from "../runtime/logger.js";
import type { RuntimePaths } from "../runtime/paths.js";

export type ActionCategory = "read" | "local_write" | "external_write" | "public_action" | "destructive" | "money" | "unknown";
export type PermissionDecision = "allow" | "ask" | "deny";

export interface ActionPermissionRequest {
  category: ActionCategory;
  action: string;
  target?: string;
  reason?: string;
  trusted?: boolean;
  payloadJson?: string;
}

export interface ActionPermissionResult {
  decision: PermissionDecision;
  reason: string;
}

export interface PermissionApproval {
  approved: boolean;
  reason?: string;
}

export type PermissionApprover = (request: ActionPermissionRequest, proposed: ActionPermissionResult) => Promise<PermissionApproval>;

export interface PermissionPolicy {
  allowTrustedRead?: boolean;
  allowLocalWrite?: boolean;
}

const RISKY_CATEGORIES = new Set<ActionCategory>(["external_write", "public_action", "destructive", "money", "unknown"]);

export function evaluateActionPermission(request: ActionPermissionRequest, policy: PermissionPolicy = {}): ActionPermissionResult {
  if (!request.action.trim()) {
    return { decision: "deny", reason: "Empty action names are denied." };
  }

  if (request.category === "read") {
    if (request.trusted && policy.allowTrustedRead !== false) {
      return { decision: "allow", reason: "Trusted read-only actions are allowed by default." };
    }

    return { decision: "ask", reason: "Untrusted read-only actions require approval before execution." };
  }

  if (request.category === "local_write") {
    return policy.allowLocalWrite
      ? { decision: "allow", reason: "Local write actions are allowed by policy." }
      : { decision: "ask", reason: "Local write actions require approval by default." };
  }

  if (RISKY_CATEGORIES.has(request.category)) {
    return { decision: "ask", reason: `${request.category} actions require explicit approval.` };
  }

  return { decision: "deny", reason: "Unknown action category is denied." };
}

export async function reviewActionPermission(
  request: ActionPermissionRequest,
  options: {
    policy?: PermissionPolicy;
    approver?: PermissionApprover;
    paths?: RuntimePaths;
    knownSecrets?: string[];
  } = {},
): Promise<ActionPermissionResult> {
  const proposed = evaluateActionPermission(request, options.policy);

  if (proposed.decision !== "ask") {
    await logActionPermission(request, proposed, options);
    return proposed;
  }

  if (!options.approver) {
    const denied = { decision: "deny" as const, reason: `Approval required but no approver was available. ${proposed.reason}` };
    await logActionPermission(request, denied, options);
    return denied;
  }

  const approval = await options.approver(request, proposed);
  const reviewed = approval.approved
    ? { decision: "allow" as const, reason: approval.reason ?? "Approved by user." }
    : { decision: "deny" as const, reason: approval.reason ?? "Denied by user." };

  await logActionPermission(request, reviewed, options);
  return reviewed;
}

export async function logActionPermission(
  request: ActionPermissionRequest,
  result: ActionPermissionResult,
  options: { paths?: RuntimePaths; knownSecrets?: string[] } = {},
): Promise<void> {
  await appendLog(
    {
      event: "action_permission_decision",
      detail: {
        category: request.category,
        action: request.action,
        target: request.target,
        decision: result.decision,
        reason: result.reason,
      },
    },
    options,
  );
}