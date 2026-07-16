import { loadConfig, writeConfig, type MemoryRetrievalPolicy } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";

export function isMemoryRetrievalPolicy(value: string | undefined): value is MemoryRetrievalPolicy {
  return value === "full" || value === "governed";
}

export async function setMemoryRetrievalPolicy(policy: MemoryRetrievalPolicy, paths?: RuntimePaths): Promise<MemoryRetrievalPolicy> {
  const config = await loadConfig(paths);
  const nextConfig = {
    ...config,
    memory: {
      ...(config.memory ?? {}),
      retrievalPolicy: policy,
    },
  };

  await writeConfig(nextConfig, paths);
  return policy;
}