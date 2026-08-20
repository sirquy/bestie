import { redactZaloPersonalOperationResult, ZALO_PERSONAL_OPERATION_DESCRIPTORS, type ZaloPersonalOperation } from "../channels/zalo-personal/capabilities.js";
import { ZaloPersonalClient } from "../channels/zalo-personal/client.js";
import { decodeZaloPersonalSession } from "../channels/zalo-personal/session.js";
import type { AppConfig } from "../runtime/config.js";
import { loadEnvFile } from "../runtime/env.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { reviewActionPermission, type PermissionApprover, type PermissionPolicy } from "../safety/permission-policy.js";

export interface RunZaloPersonalOperationOptions {
  config: AppConfig;
  paths: RuntimePaths;
  operation: ZaloPersonalOperation;
  args: unknown[];
  approver?: PermissionApprover;
  policy?: PermissionPolicy;
  clientFactory?: (session: string) => Promise<ZaloPersonalClient>;
}

export interface ZaloPersonalOperationResult {
  ok: boolean;
  message: string;
  result?: unknown;
}

export async function runZaloPersonalOperationTool(options: RunZaloPersonalOperationOptions): Promise<ZaloPersonalOperationResult> {
  const channel = options.config.channels?.zaloPersonal;
  if (!channel?.enabled) return { ok: false, message: "Zalo Personal is not enabled." };

  const descriptor = ZALO_PERSONAL_OPERATION_DESCRIPTORS[options.operation];
  const configured = options.config.internalTools?.policies?.["internal.zalo_personal"];
  if (configured === "deny") return { ok: false, message: "Zalo Personal operations are denied by internalTools.policies.internal.zalo_personal." };
  if (options.policy?.denyExternalActions && descriptor.category !== "read") {
    return { ok: false, message: "This agent policy denies external or risky Zalo Personal operations." };
  }

  if (configured !== "allow" || descriptor.category !== "read") {
    const permission = await reviewActionPermission(
      {
        category: descriptor.category,
        action: `internal.zalo_personal:${options.operation}`,
        target: "zalo-personal",
        reason: `Run Zalo Personal operation ${options.operation}.`,
        trusted: false,
        payloadJson: JSON.stringify({ tool: "internal.zalo_personal", arguments: { operation: options.operation, args: options.args } }),
      },
      { paths: options.paths, approver: options.approver, policy: options.policy },
    );
    if (permission.decision !== "allow") return { ok: false, message: `Zalo Personal operation denied: ${permission.reason}` };
  }

  const envValues = await loadEnvFile(options.paths);
  const session = process.env[channel.sessionEnv] ?? envValues[channel.sessionEnv];
  if (!session) return { ok: false, message: `Zalo Personal session ${channel.sessionEnv} is missing. Log in again with bestie channels zalo-personal login.` };

  try {
    const client = await (options.clientFactory ?? restoreZaloPersonalClient)(session);
    const result = await client.execute(options.operation, options.args);
    return { ok: true, message: `Zalo Personal ${options.operation} completed.`, result: redactZaloPersonalOperationResult(options.operation, result) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function restoreZaloPersonalClient(session: string): Promise<ZaloPersonalClient> {
  return ZaloPersonalClient.restore(decodeZaloPersonalSession(session).credentials);
}
