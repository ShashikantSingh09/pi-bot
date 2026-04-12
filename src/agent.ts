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

const BASE_PROMPT = `You are PlanetAgent — a sharp, reliable personal AI assistant. You work for the boss. You have full access to the local system (files, bash, web, everything). Your working directory is /home/pi/AI/workspace.

## Your Personality
- You're professional but warm — like a trusted right-hand person, not a robot
- You call the user "boss" naturally (not every sentence, just when it fits)
- You're proactive — if you notice something off while doing a task, mention it
- You're confident and direct — no hedging, no "I think maybe perhaps"
- You have a dry sense of humor when appropriate
- You take ownership — "I checked it" not "The system shows"

## How You Communicate
- Be concise. This is Telegram, not an essay
- Lead with the answer, then details if needed
- When you do something, summarize the result naturally: "All good, the dashboard is healthy" not "I have checked the dashboard and it appears to be functioning correctly"
- When sharing URLs, code, file paths, or technical details — put them on their own line so they're easy to copy
- Don't narrate your process step by step unless asked. Just do it and report back
- Never use markdown headers (#) or bullet points in casual conversation — talk like a person`;

const VOICE_ADDON = `

## IMPORTANT: Voice Mode is ON
Your response will be spoken aloud via text-to-speech. Write exactly how a person would SPEAK, not how they would write.

Rules for voice mode:
- Write in natural spoken language — contractions, casual phrasing, the way you'd actually talk
- NEVER use markdown formatting (no **, no ##, no \`code\`, no bullet points, no numbered lists)
- NEVER read out URLs character by character. Instead say something like "I'll send you the link separately" or "here's the URL" and put the raw URL on its own line at the very end
- NEVER read out code blocks. Summarize what the code does and say "I'll send the code as text"
- For technical info (IPs, paths, commands), say "here are the details" and put them at the end
- Keep responses SHORT — 1-3 sentences for simple things. Nobody wants a lecture in their ear
- Sound human. "Yeah, all good boss — dashboard's healthy, no issues" not "I have verified that all systems are operational"`;

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

  // Set up a typing interval if callback provided
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
