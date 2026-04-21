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

function getTimeContext(): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };
  const formatted = now.toLocaleString("en-IN", options);
  const hour = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getHours();

  let timeOfDay: string;
  if (hour >= 5 && hour < 12) timeOfDay = "morning";
  else if (hour >= 12 && hour < 17) timeOfDay = "afternoon";
  else if (hour >= 17 && hour < 21) timeOfDay = "evening";
  else timeOfDay = "night";

  return `[Current time: ${formatted} | ${timeOfDay} in Lucknow, India]`;
}

function loadDailyMemory(): string {
  const memoryDir = join(import.meta.dir, "..", "memory");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  const parts: string[] = [];
  for (const date of [yesterday, today]) {
    try {
      const content = readFileSync(join(memoryDir, `${date}.md`), "utf8").trim();
      if (content) parts.push(`[Memory log ${date}]\n${content}`);
    } catch {}
  }

  return parts.length > 0 ? parts.join("\n\n") : "";
}

function loadPersonality(voiceMode: boolean): string {
  const files = ["identity.md", "soul.md", "user.md", "rules.md", "tools.md", "memory.md"];
  if (voiceMode) files.push("voice.md");

  const sections: string[] = [getTimeContext()];
  for (const file of files) {
    try {
      const content = readFileSync(join(PERSONALITY_DIR, file), "utf8").trim();
      sections.push(content);
    } catch {
      // File missing — skip
    }
  }

  // Append daily memory logs
  const daily = loadDailyMemory();
  if (daily) sections.push(daily);

  return sections.join("\n\n---\n\n");
}

const CLAUDE_PATH = process.env.CLAUDE_PATH ?? "/home/pi/.local/bin/claude";

export async function runAgent(
  chatId: string,
  userMessage: string,
  options?: { onActivity?: () => void; voiceMode?: boolean; imagePath?: string }
): Promise<string> {
  const history = getHistory(chatId);

  const conversationContext = history
    .map((m: Message) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const prefix = options?.imagePath ? "[Image attached] " : "";
  const fullPrompt = conversationContext
    ? `${conversationContext}\n\nHuman: ${prefix}${userMessage}`
    : `${prefix}${userMessage}`;

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

  // Append image path as positional arg for Claude vision
  if (options?.imagePath) args.push(options.imagePath);

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

// Backward-compatible alias
export async function runAgentWithImage(
  chatId: string,
  userMessage: string,
  imagePath: string,
  options?: { onActivity?: () => void; voiceMode?: boolean }
): Promise<string> {
  return runAgent(chatId, userMessage, { ...options, imagePath });
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

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  const learnPrompt = `Review this recent conversation and update memory files if you learned anything new.

## Recent Conversation
${conversation}

## Your Tasks
1. Read /home/pi/AI/personality/memory.md — update if there are new durable facts (preferences, systems, lessons)
2. Read /home/pi/AI/personality/user.md — update if you learned something new about the boss
3. Read /home/pi/AI/personality/tools.md — update if you discovered new infrastructure
4. Write a brief session summary to /home/pi/AI/memory/${today}.md — append a timestamped one-liner about what was discussed

Keep entries concise. Don't duplicate. Don't rewrite existing content. Append only.`;

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
