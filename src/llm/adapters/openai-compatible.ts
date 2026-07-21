import { buildChatCompletionRequestBody, createHttpChatAdapter } from "./http-chat.js";

export const openAiCompatibleAdapter = createHttpChatAdapter({
  metadata: {
    id: "openai-compatible",
    displayName: "OpenAI-compatible",
    authModes: ["api-key", "local"],
    supportsStreaming: true,
    supportsVision: true,
    supportsToolCalls: false,
  },
  buildRequestBody: buildChatCompletionRequestBody,
  isAnthropic: false,
});
