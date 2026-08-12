import { runServiceCommand, type ServiceCommandOptions } from "../cli/commands/daemon.js";
import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { reviewActionPermission, type PermissionApprover, type PermissionPolicy } from "../safety/permission-policy.js";

export type ServiceToolAction = "install" | "uninstall" | "stop" | "restart";

export async function runServiceTool(options: {
  action: ServiceToolAction;
  config: AppConfig;
  paths: RuntimePaths;
  approver?: PermissionApprover;
  policy?: PermissionPolicy;
  runServiceCommand?: (options: ServiceCommandOptions) => Promise<void>;
}): Promise<{ ok: boolean; message: string; result?: { action: ServiceToolAction; output: string[] } }> {
  const tool = `internal.service_${options.action}`;
  const configured = options.config.internalTools?.policies?.[tool];
  if (configured === "deny") return { ok: false, message: `${tool} is denied by config.` };

  if (configured !== "allow") {
    const permission = await reviewActionPermission(
      { category: "local_write", action: tool, target: "Bestie background service", reason: `Agent requested service ${options.action}.`, payloadJson: JSON.stringify({ tool, arguments: {} }) },
      { paths: options.paths, approver: options.approver, policy: options.policy },
    );
    if (permission.decision !== "allow") return { ok: false, message: `Service ${options.action} denied: ${permission.reason}` };
  }

  const output: string[] = [];
  try {
    await (options.runServiceCommand ?? runServiceCommand)({ argv: ["node", "bestie", "service", options.action], paths: options.paths, writeLine: (message) => output.push(message) });
    return { ok: true, message: `Bestie service ${options.action} completed.`, result: { action: options.action, output } };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? `Service ${options.action} failed: ${error.message}` : `Service ${options.action} failed.` };
  }
}
