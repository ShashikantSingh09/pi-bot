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

const CLAUDE_PATH = process.env.CLAUDE_PATH ?? "claude";

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

  const args = [
    "--print",
    "--model", currentModel,
    "--system-prompt", SYSTEM_PROMPT,
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--output-format", "text",
    fullPrompt,
  ];

  // Set up a typing interval if callback provided
  let typingInterval: ReturnType<typeof setInterval> | undefined;
  if (onActivity) {
    typingInterval = setInterval(onActivity, 4000);
  }

  try {
    const proc = Bun.spawn([CLAUDE_PATH, ...args], {
      cwd: "/home/pi/AI/workspace",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error("Claude stderr:", stderr);
      return `Error running Claude (exit ${exitCode}): ${stderr.slice(0, 500)}`;
    }

    const text = stdout.trim();
    return text || "No response from Claude.";
  } finally {
    if (typingInterval) clearInterval(typingInterval);
  }
}
