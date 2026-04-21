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
let messagesSinceLastLearn = 0;
const LEARN_EVERY_N_MESSAGES = 10;

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
    "--no-session-persistence",
    "--output-format", "text",
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

    const text = stdout.trim();

    // Trigger background learning every N messages
    messagesSinceLastLearn++;
    if (messagesSinceLastLearn >= LEARN_EVERY_N_MESSAGES) {
      messagesSinceLastLearn = 0;
      learnInBackground(chatId);
    }

    return text || "No response from Claude.";
  } finally {
    if (typingInterval) clearInterval(typingInterval);
  }
}

/**
 * Run a background learning pass — reviews recent conversation history
 * and updates personality files (memory.md, user.md, tools.md)
 */
function learnInBackground(chatId: string) {
  const history = getHistory(chatId, 30);
  if (history.length < 5) return;

  const conversation = history
    .map((m: Message) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const learnPrompt = `Review this recent conversation and update the personality/memory files if you learned anything new.

## Recent Conversation
${conversation}

## Your Task
1. Read /home/pi/AI/personality/memory.md
2. If you learned new preferences, systems, patterns, or lessons — update the relevant section
3. Read /home/pi/AI/personality/user.md — update if you learned something new about the boss
4. Read /home/pi/AI/personality/tools.md — update if you discovered new infrastructure
5. Keep entries concise. One line per fact. Don't duplicate existing entries
6. If nothing new was learned, do nothing

Only update files if there's genuinely new information. Don't rewrite existing content.`;

  const args = [
    "--print",
    "--model", "claude-haiku-4-5-20251001",
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--output-format", "text",
    "--add-dir", PERSONALITY_DIR,
    learnPrompt,
  ];

  // Fire and forget — don't block the response
  const proc = Bun.spawn([CLAUDE_PATH, ...args], {
    cwd: "/home/pi/AI/workspace",
    stdout: "ignore",
    stderr: "pipe",
  });

  proc.exited.then((code) => {
    if (code !== 0) {
      new Response(proc.stderr).text().then((err) => {
        console.error("Learning pass failed:", err.slice(0, 200));
      });
    } else {
      console.log("Learning pass completed");
    }
  });
}
