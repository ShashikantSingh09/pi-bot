import { query, type ClaudeCodeOptions } from "@anthropic-ai/claude-code";
import { getHistory, type Message } from "./store";

const MODEL_ALIASES: Record<string, string> = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
  haiku: "claude-haiku-4-5-20251001",
};

const DEFAULT_MODEL = "claude-sonnet-4-6";

let currentModel = DEFAULT_MODEL;

export function getModel(): string {
  return currentModel;
}

export function setModel(input: string): string {
  const resolved = MODEL_ALIASES[input.toLowerCase()] ?? input;
  currentModel = resolved;
  return resolved;
}

const SYSTEM_PROMPT = `You are PlanetAgent, a personal AI assistant communicating via Telegram. You have full access to the local system (files, bash, web). Be concise in responses — Telegram messages should be readable on a phone. When executing multi-step tasks, send progress updates. Your working directory is /home/pi/AI/workspace.`;

export async function runAgent(
  chatId: string,
  userMessage: string,
  onActivity?: () => void
): Promise<string> {
  const history = getHistory(chatId);

  const conversationContext = history
    .map((m: Message) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const fullPrompt = conversationContext
    ? `${conversationContext}\n\nHuman: ${userMessage}`
    : userMessage;

  const options: ClaudeCodeOptions = {
    prompt: fullPrompt,
    model: currentModel,
    systemPrompt: SYSTEM_PROMPT,
    cwd: "/home/pi/AI/workspace",
    dangerouslySkipPermissions: true,
    options: {
      maxTurns: 30,
    },
  };

  // Set up a typing interval if callback provided
  let typingInterval: ReturnType<typeof setInterval> | undefined;
  if (onActivity) {
    typingInterval = setInterval(onActivity, 4000);
  }

  try {
    const messages = await query(options);

    // Extract the final assistant text from the response
    const assistantMessages = messages.filter(
      (m) => m.type === "text" && m.role === "assistant"
    );

    if (assistantMessages.length === 0) {
      return "No response from Claude.";
    }

    // Get the last assistant message
    const last = assistantMessages[assistantMessages.length - 1];
    return typeof last.content === "string"
      ? last.content
      : JSON.stringify(last.content);
  } finally {
    if (typingInterval) clearInterval(typingInterval);
  }
}
