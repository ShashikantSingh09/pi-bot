# PlanetAgent — Telegram-to-Claude-Code Agent

## Overview

A persistent, always-on AI agent running on a Raspberry Pi that communicates via Telegram and uses Claude Code as its backend for full agent capabilities (bash, file editing, web search, multi-step reasoning).

## Architecture

```
Telegram User (owner only)
    ↕ Telegram Bot API (long-polling)
Telegram Bot (grammy)
    ↕ message routing
Agent Controller (@anthropic-ai/claude-code SDK)
    ↕ spawns/manages subprocess
Claude Code CLI (dangerouslySkipPermissions)
    ↕ reads/writes
Conversation Store (SQLite)
```

## Access Control

- Single-user only: Telegram user ID `1173261665`
- All other senders are silently ignored
- Claude Code runs with `dangerouslySkipPermissions: true` — no interactive prompts

## Components

### 1. Telegram Bot (`src/bot.ts`)

- grammy-based bot using long-polling (no webhook, no public IP needed)
- Filters all messages to only accept from allowed user ID
- Sends "typing" indicator while Claude processes
- Splits long responses at 4096-char Telegram limit
- Commands:
  - `/clear` — wipe conversation history, confirm in chat
  - `/status` — report uptime, message count
  - `/model` — show current model, usage: `/model` to check, `/model <name>` to switch (e.g. `/model opus`, `/model sonnet`, `/model haiku`)

### 2. Agent Controller (`src/agent.ts`)

- Spawns `claude` CLI via `Bun.spawn` in `--print` mode (the npm package is CLI-only, no programmatic SDK exports)
- Configuration:
  - `dangerouslySkipPermissions: true`
  - Default model: `claude-sonnet-4-6` (latest Sonnet)
  - Model switchable at runtime via `/model` command
  - Working directory: `/home/pi/AI/workspace`
  - Timeout: 5 minutes per request
- Streams output back to the bot for real-time typing indicators
- Builds prompt from system message + conversation history + new user message

### 3. Conversation Store (`src/store.ts`)

- SQLite via `bun:sqlite` (zero external dependencies)
- Schema:
  ```sql
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,        -- 'user' or 'assistant'
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX idx_messages_chat ON messages(chat_id, created_at);
  ```
- Loads last 50 messages as context window (configurable)
- WAL mode for crash-safe writes
- `/clear` command deletes all rows for the chat

### 4. Entry Point (`src/index.ts`)

- Loads environment variables (bot token)
- Initializes SQLite database
- Starts the grammy bot
- Logs startup info

### 5. System Service (`planetagent.service`)

- systemd unit file for auto-start on boot
- `Restart=on-failure` with 10s backoff
- `WorkingDirectory=/home/pi/AI`
- Environment file at `/home/pi/AI/.env` for `TELEGRAM_BOT_TOKEN`

## Data Flow

### Incoming message:

1. Telegram delivers message → grammy handler fires
2. Check sender ID, reject if not owner
3. Send "typing" action to Telegram
4. Load last N messages from SQLite
5. Build prompt: system message + history + new message
6. Spawn Claude Code via SDK with full context
7. Stream response — send "typing" periodically to keep indicator alive
8. Send final response to Telegram (split if >4096 chars)
9. Save user message and assistant response to SQLite

### Error handling:

- Claude Code timeout (5 min) → send error message to Telegram
- Claude Code crash → send error message, log details
- Bot disconnect → systemd restarts the process
- SQLite uses WAL mode for crash safety

## Model Management

- Default model: `claude-sonnet-4-6`
- Stored in memory (resets to default on restart)
- `/model` — replies with current model name
- `/model sonnet` — switch to `claude-sonnet-4-6`
- `/model opus` — switch to `claude-opus-4-6`
- `/model haiku` — switch to `claude-haiku-4-5-20251001`
- `/model <full-id>` — switch to any arbitrary model ID
- Model change takes effect on the next message

## System Prompt

The Claude Code subprocess receives a system prompt establishing its role:

> You are PlanetAgent, a personal AI assistant communicating via Telegram. You have full access to the local system (files, bash, web). Be concise in responses — Telegram messages should be readable on a phone. When executing multi-step tasks, send progress updates. Your working directory is /home/pi/AI/workspace.

## Tech Stack

- **Runtime:** Bun
- **Bot framework:** grammy
- **Claude backend:** `claude` CLI (`--print` mode via `Bun.spawn`)
- **Database:** SQLite via `bun:sqlite`
- **Process manager:** systemd

## File Structure

```
/home/pi/AI/
├── src/
│   ├── index.ts          # entry point
│   ├── bot.ts            # telegram bot layer
│   ├── agent.ts          # claude code controller
│   └── store.ts          # sqlite conversation store
├── workspace/            # claude code working directory
├── data/
│   └── planetagent.db    # sqlite database
├── planetagent.service   # systemd unit file
├── package.json
├── tsconfig.json
└── .env                  # TELEGRAM_BOT_TOKEN
```
