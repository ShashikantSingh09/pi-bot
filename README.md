# Pi — Personal AI Security Agent

A persistent, always-on AI agent that runs on a Raspberry Pi and communicates via Telegram. Pi acts as your Chief Security Officer and sysadmin — monitoring infrastructure, detecting threats, running health checks, and handling day-to-day ops through natural conversation.

Built on Claude Code as the AI backend, with a multi-file personality system inspired by [OpenClaw](https://github.com/openclaw/openclaw). 

## Features

- **Telegram Bot** — Chat with Pi via text, voice, or photos
- **Security Monitoring** — Every 30 min: SSH brute-force detection, port scanning, process anomalies, auth log analysis, file integrity checks, firewall verification
- **System Health** — Disk, RAM, CPU temp, Docker container monitoring
- **Morning Briefings** — 7 AM daily digest: weather, system status, security intel, AI news, market intel
- **Voice Mode** — ElevenLabs TTS + whisper.cpp STT. Toggle with `/voice`
- **Photo Analysis** — Send screenshots/images for Claude vision analysis
- **Persistent Memory** — SQLite conversation history + daily memory logs
- **Auto-Learning** — Agent updates its own personality files as it learns about you and your infrastructure
- **Proactive Alerts** — Only notifies when something is actually wrong. Silence = all good

## Architecture

```
Telegram (you)
  ↕
grammy Bot (long-polling)
  ↕
Agent Controller (claude --print)
  ↕
Claude Code CLI (Sonnet for chat, Haiku for monitoring)
  ↕
Personality System (MD files) + SQLite + Daily Memory Logs
```

## Quick Start

### Prerequisites

- Raspberry Pi (or any Linux machine) with 4GB+ RAM
- [Bun](https://bun.sh) runtime
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Telegram Bot token (from [@BotFather](https://t.me/BotFather))
- ffmpeg (for voice processing)

### 1. Clone and install

```bash
git clone https://github.com/ShashikantSingh09/pi-bot.git
cd pi-bot
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```
TELEGRAM_BOT_TOKEN=your-bot-token
OWNER_ID=your-telegram-user-id
ELEVENLABS_API_KEY=your-key          # optional, for voice replies
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL  # optional, default: Sarah
```

To find your Telegram user ID, message [@userinfobot](https://t.me/userinfobot).

### 3. Create working directories

```bash
mkdir -p workspace data memory
```

### 4. Customize personality (optional)

Edit the files in `personality/` to match your setup:

| File | Purpose |
|------|---------|
| `identity.md` | Agent name, role, emoji |
| `soul.md` | Core personality, security mindset, communication style |
| `user.md` | Info about you (the boss) |
| `rules.md` | Operating rules, learning behavior, security posture |
| `tools.md` | Your environment — services, IPs, paths |
| `memory.md` | Long-term memory (agent updates this automatically) |
| `heartbeat.md` | Health + security checks run every 30 min |
| `voice.md` | Voice mode formatting rules |

### 5. Run

```bash
# Development (with auto-reload)
bun run dev

# Production
bun run start
```

### 6. Install as system service (recommended)

```bash
# Copy and enable the service
sudo cp planetagent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable planetagent
sudo systemctl start planetagent

# Check status
sudo systemctl status planetagent

# View logs
sudo journalctl -u planetagent -f
```

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/model` | Show current AI model |
| `/model sonnet` | Switch to Sonnet |
| `/model opus` | Switch to Opus |
| `/model haiku` | Switch to Haiku |
| `/voice` | Toggle voice replies on/off |
| `/clear` | Clear conversation history |
| `/status` | Show system status, uptime, Docker containers |

## How It Works

### Chat Flow
1. You send a message on Telegram
2. Pi loads your conversation history from SQLite
3. Builds a system prompt from all personality MD files + current time
4. Calls `claude --print` with the full context
5. Formats the response (markdown → Telegram HTML)
6. Sends it back (+ voice if toggled on)

### Heartbeat (every 30 min)
- Runs system health checks (disk, RAM, CPU, Docker)
- Runs security checks (SSH, ports, processes, auth, firewall)
- Uses Haiku model (fast + cheap)
- Only alerts if something is wrong

### Morning Briefing (7 AM daily)
- Fetches weather for your location
- Checks system health
- Reads security/AI/market news from data files
- Sends a conversational summary via Telegram

### Auto-Learning
- Every 10 messages, a background process reviews the conversation
- Updates `personality/memory.md` with new facts
- Updates `personality/user.md` with preferences
- Writes daily logs to `memory/YYYY-MM-DD.md`

## Voice Setup (Optional)

### Text-to-Speech (ElevenLabs)
1. Get an API key from [elevenlabs.io](https://elevenlabs.io)
2. Add to `.env`: `ELEVENLABS_API_KEY=your-key`
3. The default voice is Sarah. Change via `ELEVENLABS_VOICE_ID` in `.env`

### Speech-to-Text (whisper.cpp)
1. Build [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
2. Download a model: `bash ./models/download-ggml-model.sh base`
3. Set paths in `.env` or `personality/tools.md`

## Project Structure

```
pi-bot/
├── src/
│   ├── index.ts          # Entry point — starts bot, heartbeat, scheduler
│   ├── bot.ts            # Telegram handlers (text, voice, photo)
│   ├── agent.ts          # Claude CLI backend + auto-learning
│   ├── heartbeat.ts      # Proactive health + security monitoring
│   ├── scheduler.ts      # Morning briefing scheduler
│   ├── notify.ts         # Push notifications to Telegram
│   ├── format.ts         # Markdown → Telegram HTML converter
│   ├── store.ts          # SQLite conversation history
│   └── voice.ts          # Whisper STT + ElevenLabs TTS
├── personality/           # Agent personality (editable MD files)
│   ├── identity.md
│   ├── soul.md
│   ├── user.md
│   ├── rules.md
│   ├── tools.md
│   ├── memory.md
│   ├── heartbeat.md
│   └── voice.md
├── memory/                # Daily memory logs (auto-generated)
├── workspace/             # Claude Code working directory
├── data/                  # SQLite DB + temp files
├── planetagent.service    # systemd unit file
├── package.json
└── tsconfig.json
```

## License

MIT
