# PlanetAgent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent Telegram bot on Raspberry Pi that routes messages to Claude Code and sends responses back, with conversation history and model switching.

**Architecture:** grammy bot (long-polling) → agent controller (Claude Code SDK) → SQLite conversation store. Single-user access, systemd-managed.

**Tech Stack:** Bun, grammy, @anthropic-ai/claude-code SDK, bun:sqlite, systemd

---

### Task 1: Project scaffolding and dependencies

**Files:**
- Create: `/home/pi/AI/package.json`
- Create: `/home/pi/AI/tsconfig.json`
- Create: `/home/pi/AI/.env`

- [ ] **Step 1: Initialize project**

```bash
cd /home/pi/AI
bun init -y
```

- [ ] **Step 2: Install dependencies**

```bash
cd /home/pi/AI
bun add grammy @anthropic-ai/claude-code
```

- [ ] **Step 3: Create tsconfig.json**

Write `/home/pi/AI/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create .env file**

Write `/home/pi/AI/.env`:

```
TELEGRAM_BOT_TOKEN=8547615043:AAGM4a2h1uKzrf-RpU3wqN3ge_35YSc9i5g
OWNER_ID=1173261665
```

- [ ] **Step 5: Create workspace and data directories**

```bash
mkdir -p /home/pi/AI/workspace /home/pi/AI/data
```

- [ ] **Step 6: Add .gitignore**

Write `/home/pi/AI/.gitignore`:

```
node_modules/
data/
.env
dist/
workspace/
```

- [ ] **Step 7: Initialize git repo and commit**

```bash
cd /home/pi/AI
git init
git add package.json tsconfig.json .gitignore
git commit -m "feat: initialize planetagent project"
```

---

### Task 2: Conversation Store (`src/store.ts`)

**Files:**
- Create: `/home/pi/AI/src/store.ts`
- Test: manual verification via bun repl

- [ ] **Step 1: Create the store module**

Write `/home/pi/AI/src/store.ts`:

```typescript
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";

const DB_PATH = process.env.DB_PATH ?? "data/planetagent.db";

mkdirSync("data", { recursive: true });

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode=WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
`);

export interface Message {
  role: "user" | "assistant";
  content: string;
}

const insertStmt = db.prepare(
  "INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)"
);

const selectStmt = db.prepare(
  "SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?"
);

const deleteStmt = db.prepare("DELETE FROM messages WHERE chat_id = ?");

const countStmt = db.prepare(
  "SELECT COUNT(*) as count FROM messages WHERE chat_id = ?"
);

export function saveMessage(
  chatId: string,
  role: "user" | "assistant",
  content: string
): void {
  insertStmt.run(chatId, role, content);
}

export function getHistory(chatId: string, limit = 50): Message[] {
  const rows = selectStmt.all(chatId, limit) as Message[];
  return rows.reverse();
}

export function clearHistory(chatId: string): void {
  deleteStmt.run(chatId);
}

export function messageCount(chatId: string): number {
  const row = countStmt.get(chatId) as { count: number };
  return row.count;
}
```

- [ ] **Step 2: Verify the store compiles**

```bash
cd /home/pi/AI
bun build src/store.ts --target=bun --outdir=dist 2>&1 | head -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/pi/AI
git add src/store.ts
git commit -m "feat: add sqlite conversation store"
```

---

### Task 3: Agent Controller (`src/agent.ts`)

**Files:**
- Create: `/home/pi/AI/src/agent.ts`

- [ ] **Step 1: Create the agent module**

Write `/home/pi/AI/src/agent.ts`:

```typescript
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
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /home/pi/AI
bun build src/agent.ts --target=bun --outdir=dist 2>&1 | head -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/pi/AI
git add src/agent.ts
git commit -m "feat: add claude code agent controller with model switching"
```

---

### Task 4: Telegram Bot (`src/bot.ts`)

**Files:**
- Create: `/home/pi/AI/src/bot.ts`

- [ ] **Step 1: Create the bot module**

Write `/home/pi/AI/src/bot.ts`:

```typescript
import { Bot } from "grammy";
import { runAgent, getModel, setModel } from "./agent";
import { saveMessage, clearHistory, messageCount } from "./store";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required in .env");
  process.exit(1);
}

const OWNER_ID = Number(process.env.OWNER_ID);
if (!OWNER_ID) {
  console.error("OWNER_ID is required in .env");
  process.exit(1);
}

export const bot = new Bot(TOKEN);
const startTime = Date.now();

// Access control: only allow owner
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== OWNER_ID) return;
  await next();
});

// /clear command
bot.command("clear", async (ctx) => {
  const chatId = String(ctx.chat.id);
  clearHistory(chatId);
  await ctx.reply("Conversation cleared.");
});

// /status command
bot.command("status", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const count = messageCount(chatId);
  const uptimeMs = Date.now() - startTime;
  const uptimeMin = Math.floor(uptimeMs / 60000);
  const uptimeHr = Math.floor(uptimeMin / 60);
  const uptime =
    uptimeHr > 0
      ? `${uptimeHr}h ${uptimeMin % 60}m`
      : `${uptimeMin}m`;

  await ctx.reply(
    `Status:\n• Model: ${getModel()}\n• Messages: ${count}\n• Uptime: ${uptime}`
  );
});

// /model command
bot.command("model", async (ctx) => {
  const arg = ctx.match?.trim();
  if (!arg) {
    await ctx.reply(`Current model: ${getModel()}`);
    return;
  }
  const resolved = setModel(arg);
  await ctx.reply(`Model switched to: ${resolved}`);
});

// Message handler
bot.on("message:text", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const text = ctx.message.text;

  // Save user message
  saveMessage(chatId, "user", text);

  // Send typing indicator
  await ctx.replyWithChatAction("typing");

  try {
    const response = await runAgent(chatId, text, () => {
      ctx.replyWithChatAction("typing").catch(() => {});
    });

    // Save assistant response
    saveMessage(chatId, "assistant", response);

    // Split long messages (Telegram limit: 4096 chars)
    const chunks = splitMessage(response, 4096);
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Unknown error";
    console.error("Agent error:", msg);
    await ctx.reply(`Error: ${msg}`);
  }
});

function splitMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    // Try to split at last newline before limit
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt <= 0) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /home/pi/AI
bun build src/bot.ts --target=bun --outdir=dist 2>&1 | head -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/pi/AI
git add src/bot.ts
git commit -m "feat: add telegram bot with commands and message routing"
```

---

### Task 5: Entry Point (`src/index.ts`)

**Files:**
- Create: `/home/pi/AI/src/index.ts`

- [ ] **Step 1: Create entry point**

Write `/home/pi/AI/src/index.ts`:

```typescript
import { bot } from "./bot";
import { getModel } from "./agent";

console.log(`PlanetAgent starting...`);
console.log(`Model: ${getModel()}`);
console.log(`Owner: ${process.env.OWNER_ID}`);

bot.start({
  onStart: () => {
    console.log("PlanetAgent is running.");
  },
});
```

- [ ] **Step 2: Update package.json scripts**

Add to `/home/pi/AI/package.json` scripts section:

```json
{
  "scripts": {
    "start": "bun run src/index.ts",
    "dev": "bun --watch run src/index.ts"
  }
}
```

- [ ] **Step 3: Test the bot starts**

```bash
cd /home/pi/AI
timeout 10 bun run start 2>&1 || true
```

Expected: "PlanetAgent starting..." and "PlanetAgent is running." (then timeout kills it).

- [ ] **Step 4: Commit**

```bash
cd /home/pi/AI
git add src/index.ts package.json
git commit -m "feat: add entry point and start script"
```

---

### Task 6: End-to-end test via Telegram

- [ ] **Step 1: Start the bot**

```bash
cd /home/pi/AI
bun run start
```

- [ ] **Step 2: Send a test message**

From Telegram, send "Hello" to `@Planetdevs09bot`. Verify:
- Bot shows typing indicator
- Bot responds with a message from Claude
- No errors in terminal

- [ ] **Step 3: Test /model command**

Send `/model` — should reply with "Current model: claude-sonnet-4-6"
Send `/model opus` — should reply with "Model switched to: claude-opus-4-6"
Send `/model` — should reply with "Current model: claude-opus-4-6"
Send `/model sonnet` — switch back

- [ ] **Step 4: Test /clear command**

Send `/clear` — should reply "Conversation cleared."

- [ ] **Step 5: Test /status command**

Send `/status` — should show model, message count, uptime.

- [ ] **Step 6: Fix any issues found during testing**

If the Claude Code SDK `query()` response format differs from what we expect, adjust `src/agent.ts` to match the actual response shape.

---

### Task 7: systemd service

**Files:**
- Create: `/home/pi/AI/planetagent.service`

- [ ] **Step 1: Create the service file**

Write `/home/pi/AI/planetagent.service`:

```ini
[Unit]
Description=PlanetAgent Telegram Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/AI
EnvironmentFile=/home/pi/AI/.env
ExecStart=/home/pi/.local/bin/bun run src/index.ts
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Install and enable the service**

```bash
sudo cp /home/pi/AI/planetagent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable planetagent
sudo systemctl start planetagent
```

- [ ] **Step 3: Verify service is running**

```bash
sudo systemctl status planetagent
journalctl -u planetagent -n 20 --no-pager
```

Expected: active (running), logs show "PlanetAgent is running."

- [ ] **Step 4: Test bot responds via Telegram while running as a service**

Send a message from Telegram. Verify response comes back.

- [ ] **Step 5: Commit**

```bash
cd /home/pi/AI
git add planetagent.service
git commit -m "feat: add systemd service for auto-start"
```
