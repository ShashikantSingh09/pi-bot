# PlanetAgent v2: Proactive Agent Features

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform PlanetAgent from a reactive chatbot into a proactive, self-aware agent that monitors systems, sends alerts, knows what time it is, handles images, and evolves its own personality — inspired by OpenClaw's architecture.

**Architecture:** Add a heartbeat loop (cron-style) to the existing systemd service that wakes the agent every 30 minutes to run checks from a HEARTBEAT.md file. Add daily memory logs, time-awareness in prompts, photo message handling, and an IDENTITY.md file. All new features integrate with the existing Telegram bot and personality system.

**Tech Stack:** Bun, grammy, claude CLI, bun:sqlite, node-cron

---

## File Structure

```
/home/pi/AI/
├── src/
│   ├── index.ts          # MODIFY — add heartbeat scheduler startup
│   ├── bot.ts            # MODIFY — add photo handler, time context
│   ├── agent.ts          # MODIFY — inject time/date context into prompt
│   ├── heartbeat.ts      # CREATE — heartbeat loop + HEARTBEAT.md evaluator
│   ├── notify.ts         # CREATE — proactive Telegram notifications
│   ├── format.ts         # existing (no changes)
│   ├── store.ts          # existing (no changes)
│   └── voice.ts          # existing (no changes)
├── personality/
│   ├── identity.md       # CREATE — agent name, role, emoji, avatar
│   ├── heartbeat.md      # CREATE — scheduled checks and thresholds
│   ├── soul.md           # existing (no changes)
│   ├── user.md           # existing (no changes)
│   ├── rules.md          # MODIFY — add heartbeat rules section
│   ├── tools.md          # existing (no changes)
│   ├── memory.md         # existing (no changes)
│   └── voice.md          # existing (no changes)
├── memory/               # CREATE — daily memory logs directory
│   └── YYYY-MM-DD.md     # auto-created by agent
```

---

### Task 1: IDENTITY.md — Agent Identity File

**Files:**
- Create: `/home/pi/AI/personality/identity.md`
- Modify: `/home/pi/AI/src/agent.ts`

- [ ] **Step 1: Create identity.md**

Write `/home/pi/AI/personality/identity.md`:

```markdown
name: PlanetAgent
role: Senior Sysadmin & Security Analyst
emoji: 🛡️
greeting: What do you need, boss?
ack_reaction: 👍
status_prefix: 🛡️ PlanetAgent
```

- [ ] **Step 2: Update agent.ts to load identity.md**

In `/home/pi/AI/src/agent.ts`, add `"identity.md"` to the beginning of the files array in `loadPersonality()`:

```typescript
function loadPersonality(voiceMode: boolean): string {
  const files = ["identity.md", "soul.md", "user.md", "rules.md", "tools.md", "memory.md"];
  if (voiceMode) files.push("voice.md");
  // ... rest unchanged
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd /home/pi/AI
bun build src/bot.ts --target=bun --outdir=dist 2>&1 | head -3
```

- [ ] **Step 4: Commit**

```bash
cd /home/pi/AI
git add personality/identity.md src/agent.ts
git commit -m "feat: add identity.md for agent name, role, emoji"
```

---

### Task 2: Time & Context Awareness

**Files:**
- Modify: `/home/pi/AI/src/agent.ts`

- [ ] **Step 1: Add time context injection to agent.ts**

In `/home/pi/AI/src/agent.ts`, add a function to generate time context and inject it into the system prompt. Add this function after the imports:

```typescript
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
```

Then modify the `loadPersonality` function to prepend the time context:

```typescript
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
  return sections.join("\n\n---\n\n");
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /home/pi/AI
bun build src/bot.ts --target=bun --outdir=dist 2>&1 | head -3
```

- [ ] **Step 3: Commit**

```bash
cd /home/pi/AI
git add src/agent.ts
git commit -m "feat: inject time/date context into agent prompt"
```

---

### Task 3: Notification Module

**Files:**
- Create: `/home/pi/AI/src/notify.ts`

- [ ] **Step 1: Create the notification module**

Write `/home/pi/AI/src/notify.ts`:

```typescript
import { Bot } from "grammy";
import { markdownToTelegramHtml } from "./format";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const OWNER_CHAT_ID = process.env.OWNER_ID!;

// Lazy-init a separate bot instance for sending proactive messages
let notifyBot: Bot | null = null;

function getBot(): Bot {
  if (!notifyBot) {
    notifyBot = new Bot(TOKEN);
  }
  return notifyBot;
}

/**
 * Send a proactive notification to the boss via Telegram.
 * Used by heartbeat, scheduled tasks, and alerts.
 * Does NOT use long-polling — just the sendMessage API.
 */
export async function notify(message: string): Promise<void> {
  const html = markdownToTelegramHtml(message);
  try {
    await getBot().api.sendMessage(OWNER_CHAT_ID, html, { parse_mode: "HTML" });
  } catch {
    // Fallback to plain text
    try {
      const plain = html.replace(/<[^>]+>/g, "");
      await getBot().api.sendMessage(OWNER_CHAT_ID, plain);
    } catch (err) {
      console.error("Failed to send notification:", err);
    }
  }
}

/**
 * Send a notification with a voice message attached.
 */
export async function notifyWithVoice(
  message: string,
  oggPath: string
): Promise<void> {
  const { InputFile } = await import("grammy");
  try {
    await getBot().api.sendVoice(OWNER_CHAT_ID, new InputFile(oggPath));
  } catch (err) {
    console.error("Failed to send voice notification:", err);
  }
  await notify(message);
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /home/pi/AI
bun build src/notify.ts --target=bun --outdir=dist 2>&1 | head -3
```

- [ ] **Step 3: Commit**

```bash
cd /home/pi/AI
git add src/notify.ts
git commit -m "feat: add notification module for proactive Telegram alerts"
```

---

### Task 4: Heartbeat System

**Files:**
- Create: `/home/pi/AI/personality/heartbeat.md`
- Create: `/home/pi/AI/src/heartbeat.ts`
- Modify: `/home/pi/AI/src/index.ts`

- [ ] **Step 1: Create heartbeat.md**

Write `/home/pi/AI/personality/heartbeat.md`:

```markdown
## Heartbeat Checklist

You are running a scheduled health check. Evaluate each item below. Only alert the boss if something needs attention. If everything is fine, respond with exactly: HEARTBEAT_OK

### Active Hours
Only run checks between 06:00 and 00:00 IST. Outside active hours, respond HEARTBEAT_OK immediately.

### Checks (every 30 minutes)

1. **Disk space** — alert if root partition > 90%
2. **RAM usage** — alert if available memory < 15%
3. **CPU temperature** — alert if > 80°C
4. **Docker containers** — alert if any container is unhealthy or exited
5. **PlanetAgent service** — verify this service is responsive (if you're running, it is)
6. **Network connectivity** — quick ping to 8.8.8.8

### Alert Format

If something needs attention, write a SHORT natural message like:
"⚠️ Heads up boss — disk is at 92%. Want me to clean up?"

Do NOT write a full report. Only mention what's wrong. If multiple things are wrong, combine into one message.

### What NOT to do
- Don't run heavy scans (nmap, etc.) during heartbeat — those are separate scheduled tasks
- Don't update memory files during heartbeat — save that for conversations
- Don't send "all good" messages — silence means everything is fine
```

- [ ] **Step 2: Create heartbeat.ts**

Write `/home/pi/AI/src/heartbeat.ts`:

```typescript
import { readFileSync } from "fs";
import { join } from "path";
import { notify } from "./notify";

const CLAUDE_PATH = process.env.CLAUDE_PATH ?? "/home/pi/.local/bin/claude";
const PERSONALITY_DIR = join(import.meta.dir, "..", "personality");
const HEARTBEAT_INTERVAL = 30 * 60 * 1000; // 30 minutes

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
  return `[Current time: ${now.toLocaleString("en-IN", options)}]`;
}

function loadHeartbeatPrompt(): string {
  const parts: string[] = [getTimeContext()];

  // Load identity + soul for personality consistency
  for (const file of ["identity.md", "soul.md"]) {
    try {
      parts.push(readFileSync(join(PERSONALITY_DIR, file), "utf8").trim());
    } catch {}
  }

  // Load heartbeat checklist
  try {
    parts.push(readFileSync(join(PERSONALITY_DIR, "heartbeat.md"), "utf8").trim());
  } catch {
    return "";
  }

  return parts.join("\n\n---\n\n");
}

async function runHeartbeat(): Promise<void> {
  const systemPrompt = loadHeartbeatPrompt();
  if (!systemPrompt) {
    console.log("Heartbeat: no heartbeat.md found, skipping");
    return;
  }

  console.log("Heartbeat: running checks...");

  const args = [
    "--print",
    "--model", "claude-haiku-4-5-20251001",
    "--system-prompt", systemPrompt,
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--output-format", "text",
    "Run the heartbeat checklist now. Check each item and report only if something needs attention.",
  ];

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
      console.error("Heartbeat: claude failed:", stderr.slice(0, 200));
      return;
    }

    const result = stdout.trim();

    if (!result || result === "HEARTBEAT_OK" || result.includes("HEARTBEAT_OK")) {
      console.log("Heartbeat: all clear");
      return;
    }

    // Something needs attention — notify the boss
    console.log("Heartbeat: alert ->", result.slice(0, 100));
    await notify(result);
  } catch (err) {
    console.error("Heartbeat: error:", err);
  }
}

export function startHeartbeat(): void {
  console.log(`Heartbeat: scheduled every ${HEARTBEAT_INTERVAL / 60000} minutes`);

  // Run first heartbeat after 60 seconds (let bot finish starting)
  setTimeout(() => {
    runHeartbeat();
    // Then run on interval
    setInterval(runHeartbeat, HEARTBEAT_INTERVAL);
  }, 60_000);
}
```

- [ ] **Step 3: Update index.ts to start heartbeat**

Replace `/home/pi/AI/src/index.ts` with:

```typescript
import { bot } from "./bot";
import { getModel } from "./agent";
import { startHeartbeat } from "./heartbeat";

console.log(`PlanetAgent starting...`);
console.log(`Model: ${getModel()}`);
console.log(`Owner: ${process.env.OWNER_ID}`);

bot.start({
  onStart: () => {
    console.log("PlanetAgent is running.");
    startHeartbeat();
  },
});
```

- [ ] **Step 4: Verify it compiles**

```bash
cd /home/pi/AI
bun build src/index.ts --target=bun --outdir=dist 2>&1 | head -3
```

- [ ] **Step 5: Restart and verify heartbeat starts**

```bash
sudo systemctl restart planetagent
sudo journalctl -u planetagent -n 10 --no-pager
```

Expected: "Heartbeat: scheduled every 30 minutes" in logs.

- [ ] **Step 6: Commit**

```bash
cd /home/pi/AI
git add personality/heartbeat.md src/heartbeat.ts src/index.ts
git commit -m "feat: add heartbeat system — proactive monitoring every 30 minutes"
```

---

### Task 5: Daily Memory Logs

**Files:**
- Modify: `/home/pi/AI/src/agent.ts`
- Modify: `/home/pi/AI/personality/rules.md`

- [ ] **Step 1: Create memory directory**

```bash
mkdir -p /home/pi/AI/memory
```

- [ ] **Step 2: Update agent.ts to load daily memory**

In `/home/pi/AI/src/agent.ts`, add a function to load today's and yesterday's memory logs. Add after the `getTimeContext()` function:

```typescript
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
```

Then add daily memory to the personality loader, after memory.md:

```typescript
function loadPersonality(voiceMode: boolean): string {
  const files = ["identity.md", "soul.md", "user.md", "rules.md", "tools.md", "memory.md"];
  if (voiceMode) files.push("voice.md");

  const sections: string[] = [getTimeContext()];
  for (const file of files) {
    try {
      const content = readFileSync(join(PERSONALITY_DIR, file), "utf8").trim();
      sections.push(content);
    } catch {}
  }

  // Append daily memory logs
  const daily = loadDailyMemory();
  if (daily) sections.push(daily);

  return sections.join("\n\n---\n\n");
}
```

- [ ] **Step 3: Update rules.md learning section**

Add to the Learning & Memory section in `/home/pi/AI/personality/rules.md`, after the existing content:

```markdown
**Daily memory logs:**
- Write session notes to /home/pi/AI/memory/YYYY-MM-DD.md (use today's date in Asia/Kolkata timezone)
- Each entry: one line with timestamp and fact. Example: "14:30 — Boss asked to check Docker, found container X unhealthy, restarted it"
- Today's and yesterday's logs are loaded into your context automatically
- Important facts that should persist long-term go in /home/pi/AI/personality/memory.md
- Daily logs are for temporal context — what happened today, what was discussed
```

- [ ] **Step 4: Also update the learning background task in agent.ts**

Update the `learnInBackground` function's `learnPrompt` to include daily log instructions. Replace the `learnPrompt` string with:

```typescript
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
```

- [ ] **Step 5: Verify it compiles**

```bash
cd /home/pi/AI
bun build src/bot.ts --target=bun --outdir=dist 2>&1 | head -3
```

- [ ] **Step 6: Commit**

```bash
cd /home/pi/AI
git add src/agent.ts personality/rules.md
git commit -m "feat: daily memory logs — temporal context from today + yesterday"
```

---

### Task 6: Photo/Image Message Handling

**Files:**
- Modify: `/home/pi/AI/src/bot.ts`

- [ ] **Step 1: Add photo handler to bot.ts**

Add after the voice message handler in `/home/pi/AI/src/bot.ts`:

```typescript
// Photo message handler
bot.on("message:photo", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const caption = ctx.message.caption || "What do you see in this image?";

  await ctx.replyWithChatAction("typing");

  try {
    // Get the highest resolution photo
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    const file = await ctx.api.getFile(photo.file_id);
    const filePath = file.file_path;
    if (!filePath) throw new Error("Could not get photo file path");

    const url = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download photo: ${res.status}`);

    const imgPath = `/home/pi/AI/data/tmp/${Date.now()}-photo.jpg`;
    const { mkdirSync } = await import("fs");
    mkdirSync("/home/pi/AI/data/tmp", { recursive: true });
    await Bun.write(imgPath, await res.arrayBuffer());

    // Save caption as user message
    saveMessage(chatId, "user", `[Sent a photo] ${caption}`);

    // Run claude with the image
    const { runAgentWithImage } = await import("./agent");
    const response = await runAgentWithImage(chatId, caption, imgPath, {
      onActivity: () => { ctx.replyWithChatAction("typing").catch(() => {}); },
      voiceMode: voiceReplyEnabled,
    });

    saveMessage(chatId, "assistant", response);

    // Clean up image
    await (await import("fs/promises")).unlink(imgPath).catch(() => {});

    if (voiceReplyEnabled) {
      try {
        await ctx.replyWithChatAction("record_voice");
        const oggOut = await synthesize(response);
        await ctx.replyWithVoice(new InputFile(oggOut));
        await cleanupTTS(oggOut);
        if (hasTextContent(response)) {
          await sendFormattedReply(ctx, response);
        }
        return;
      } catch (ttsErr) {
        console.error("TTS failed, falling back to text:", ttsErr);
      }
    }

    await sendFormattedReply(ctx, response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Photo error:", msg);
    await ctx.reply(`Error processing photo: ${msg}`);
  }
});
```

- [ ] **Step 2: Add runAgentWithImage to agent.ts**

Add this exported function at the end of `/home/pi/AI/src/agent.ts`, before the `learnInBackground` function:

```typescript
export async function runAgentWithImage(
  chatId: string,
  userMessage: string,
  imagePath: string,
  options?: { onActivity?: () => void; voiceMode?: boolean }
): Promise<string> {
  const history = getHistory(chatId);

  const conversationContext = history
    .map((m: Message) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  // For images, we pipe the prompt via stdin and pass the image as a file argument
  const fullPrompt = conversationContext
    ? `${conversationContext}\n\nHuman: [Image attached] ${userMessage}`
    : `[Image attached] ${userMessage}`;

  const systemPrompt = loadPersonality(options?.voiceMode ?? false);

  const args = [
    "--print",
    "--model", currentModel,
    "--system-prompt", systemPrompt,
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--output-format", "text",
    fullPrompt,
    imagePath,
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
```

- [ ] **Step 3: Verify it compiles**

```bash
cd /home/pi/AI
bun build src/bot.ts --target=bun --outdir=dist 2>&1 | head -3
```

- [ ] **Step 4: Commit**

```bash
cd /home/pi/AI
git add src/bot.ts src/agent.ts
git commit -m "feat: handle photo messages with Claude vision"
```

---

### Task 7: Update Heartbeat Rules + Restart Service

**Files:**
- Modify: `/home/pi/AI/personality/rules.md`

- [ ] **Step 1: Add heartbeat rules to rules.md**

Add this section to `/home/pi/AI/personality/rules.md` after the Learning & Memory section:

```markdown
### Heartbeat Behavior

You run a heartbeat check every 30 minutes. During heartbeat:
- You're running as a lightweight check, not a full conversation
- Only alert the boss if something is genuinely wrong — silence means all good
- Use Haiku model for speed — keep checks fast
- Don't do heavy operations (no nmap, no big downloads)
- If you alert, keep it to one short message. Be specific about what's wrong
- The boss can customize checks by editing /home/pi/AI/personality/heartbeat.md
```

- [ ] **Step 2: Restart service and verify everything works**

```bash
cd /home/pi/AI
sudo systemctl restart planetagent
sudo journalctl -u planetagent -n 15 --no-pager
```

Expected: clean startup with "Heartbeat: scheduled every 30 minutes"

- [ ] **Step 3: Commit**

```bash
cd /home/pi/AI
git add personality/rules.md
git commit -m "feat: add heartbeat behavior rules to personality"
```

---

### Task 8: End-to-End Testing

- [ ] **Step 1: Test text message**

Send "hi" to the bot on Telegram. Verify natural response with no raw asterisks.

- [ ] **Step 2: Test photo message**

Send a photo (e.g. a screenshot) to the bot. Verify it describes what it sees.

- [ ] **Step 3: Test heartbeat (manual trigger)**

```bash
# Check logs after 60 seconds for first heartbeat
sudo journalctl -u planetagent -f --no-pager
```

Wait ~60 seconds. Expected: "Heartbeat: running checks..." then either "Heartbeat: all clear" or an alert notification.

- [ ] **Step 4: Test /status command**

Send `/status` on Telegram. Verify response.

- [ ] **Step 5: Test voice mode with photo**

Toggle `/voice` on, send a photo. Verify voice + text response.

- [ ] **Step 6: Verify memory learning**

After 10+ messages, check if memory files were updated:

```bash
cat /home/pi/AI/personality/memory.md
ls /home/pi/AI/memory/
cat /home/pi/AI/memory/$(date +%Y-%m-%d).md 2>/dev/null
```
