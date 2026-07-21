import { buildAnthropicMessagesRequestBody, createHttpChatAdapter } from "./http-chat.js";

export const anthropicAdapter = createHttpChatAdapter({
  metadata: {
    id: "anthropic",
    displayName: "Anthropic",
    authModes: ["api-key"],
    supportsStreaming: true,
    supportsVision: true,
    supportsToolCalls: false,
  },
  buildRequestBody: buildAnthropicMessagesRequestBody,
  isAnthropic: true,
});

export function isAnthropicProvider(provider: string): boolean {
  return ["anthropic", "claude"].includes(provider.toLowerCase());
}
