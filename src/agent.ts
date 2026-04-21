import { getHistory, type Message } from "./store";
import { readFileSync } from "fs";
import { join } from "path";

const MODEL_ALIASES: Record<string, string> = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
  haiku: "claude-haiku-4-5-20251001",
};

const DEFAULT_MODEL = "claude-sonnet-4-6";
const PERSONALITY_DIR = join(import.meta.dir, "..", "personality");

let currentModel = DEFAULT_MODEL;

export function getModel(): string {
  return currentModel;
}

export function setModel(input: string): string {
  const resolved = MODEL_ALIASES[input.toLowerCase()] ?? input;
  currentModel = resolved;
  return resolved;
}

function loadPersonality(voiceMode: boolean): string {
  const files = ["soul.md", "user.md", "rules.md", "tools.md", "memory.md"];
  if (voiceMode) files.push("voice.md");

  const sections: string[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(PERSONALITY_DIR, file), "utf8").trim();
      sections.push(content);
    } catch {
      // File missing — skip
    }
  }
  return sections.join("\n\n---\n\n");
}

const CLAUDE_PATH = process.env.CLAUDE_PATH ?? "/home/pi/.local/bin/claude";

export async function runAgent(
  chatId: string,
  userMessage: string,
  options?: { onActivity?: () => void; voiceMode?: boolean }
): Promise<string> {
  const history = getHistory(chatId);

  const conversationContext = history
    .map((m: Message) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const fullPrompt = conversationContext
    ? `${conversationContext}\n\nHuman: ${userMessage}`
    : userMessage;

  const systemPrompt = loadPersonality(options?.voiceMode ?? false);

  const args = [
    "--print",
    "--model", currentModel,
    "--system-prompt", systemPrompt,
    "--dangerously-skip-permissions",
    "--output-format", "json",
    "--add-dir", PERSONALITY_DIR,
    fullPrompt,
  ];

  let typingInterval: ReturnType<typeof setInterval> | undefined;
  if (options?.onActivity) {
    typingInterval = setInterval(options.onActivity, 4000);
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

    // Parse JSON output to extract the final assistant text
    try {
      const result = JSON.parse(stdout);

      // result.result is the final text, or result may have a different shape
      // Claude --print --output-format json returns: { result: "text", ... }
      if (result.result) {
        return result.result.trim();
      }

      // Fallback: look for the last assistant message in the messages array
      if (Array.isArray(result)) {
        const assistantMsgs = result.filter(
          (m: any) => m.role === "assistant" && m.type === "text"
        );
        if (assistantMsgs.length > 0) {
          const last = assistantMsgs[assistantMsgs.length - 1];
          return typeof last.content === "string"
            ? last.content.trim()
            : JSON.stringify(last.content);
        }
      }

      // Last resort: stringify
      return stdout.trim();
    } catch {
      // If JSON parse fails, return raw text
      return stdout.trim() || "No response from Claude.";
    }
  } finally {
    if (typingInterval) clearInterval(typingInterval);
  }
}
