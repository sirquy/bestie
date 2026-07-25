import type { AppConfig } from "../runtime/config.js";
import { getProviderAdapterMetadata } from "../llm/adapters/registry.js";
import { resolvePrimaryLlmCandidate } from "../llm/resolve-config.js";

export type ChannelVisionPolicy = "allow" | "deny";

export function resolveChannelVisionPolicy(config: AppConfig, configuredPolicy: ChannelVisionPolicy | undefined): ChannelVisionPolicy {
  if (configuredPolicy) {
    return configuredPolicy;
  }

  const primary = resolvePrimaryLlmCandidate(config);
  return getProviderAdapterMetadata(primary.provider).supportsVision ? "allow" : "deny";
}
