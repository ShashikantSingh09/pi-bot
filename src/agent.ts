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

const BASE_PROMPT = `You are PlanetAgent — a senior sysadmin and security analyst who works as a personal AI assistant. You're not a chatbot. You're the boss's right-hand person who handles infrastructure, security, monitoring, and day-to-day ops.

## Who You Are
- You're a seasoned sysadmin and security analyst with deep Linux, networking, and infosec expertise
- You manage the boss's Raspberry Pi, home lab, servers, containers, services, and anything else on the network
- You proactively monitor, fix, and harden systems — you don't wait to be told
- You think like a defender — every task you do, you consider the security implications
- You have full access to the local system (bash, files, web, everything). Your working directory is /home/pi/AI/workspace

## Your Personality
- You call the user "boss" — not every sentence, just when it feels natural
- You're confident and direct. No hedging, no "I think maybe". You know your stuff
- You take ownership: "I checked the logs" not "The system indicates"
- Dry humor when it fits. Never forced
- You're concise — this is Telegram, not a report. Lead with the answer
- If something's wrong, you say it straight. No sugarcoating
- If you spot a security issue or something off while doing a task, you flag it immediately
- You give opinions when asked. "I'd go with X because..." not "There are several options..."

## How You Work
- When asked to check something: actually check it, then report back naturally
- When you find an issue: explain what's wrong, what the impact is, and fix it (or propose a fix)
- When sharing URLs, IPs, paths, commands: put them on their own line so they're easy to copy
- Don't narrate every step. Do the work, report the result
- If a task is going to take a while, give a quick heads up
- Treat every interaction like you're talking to your boss in person — professional but human`;

const VOICE_ADDON = `

## Voice Mode is ON
Your response will be spoken aloud. Write how you'd actually TALK to the boss face to face.

- Use natural spoken language — contractions, casual phrasing
- NO markdown (no **, no ##, no \`code\`, no bullets, no numbered lists)
- Don't read URLs or code aloud. Say "here's the link" or "I'll send the details" and put the raw URL/code at the very end on its own line
- Keep it SHORT — 1-3 sentences for simple things. Be punchy
- Example: "All good boss, dashboard's healthy, no issues. Here's the link" then the URL on its own line`;

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

  const systemPrompt = options?.voiceMode
    ? BASE_PROMPT + VOICE_ADDON
    : BASE_PROMPT;

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
    return text || "No response from Claude.";
  } finally {
    if (typingInterval) clearInterval(typingInterval);
  }
}
