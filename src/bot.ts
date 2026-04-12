import { Bot, InputFile } from "grammy";
import { runAgent, getModel, setModel } from "./agent";
import { saveMessage, clearHistory, messageCount } from "./store";
import { transcribe, synthesize, cleanupTTS } from "./voice";
import { $ } from "bun";

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

// Persist voice toggle to disk so it survives restarts
const VOICE_STATE_FILE = "data/voice-state.json";
let voiceReplyEnabled = (() => {
  try {
    const data = JSON.parse(require("fs").readFileSync(VOICE_STATE_FILE, "utf8"));
    return data.enabled === true;
  } catch { return false; }
})();

function saveVoiceState() {
  require("fs").mkdirSync("data", { recursive: true });
  require("fs").writeFileSync(VOICE_STATE_FILE, JSON.stringify({ enabled: voiceReplyEnabled }));
}

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

  // Fetch Docker container status
  let containerLines = "";
  try {
    const result = await $`docker ps --format "{{.Names}}\t{{.Status}}"`.text();
    const rows = result.trim().split("\n").filter(Boolean);
    if (rows.length === 0) {
      containerLines = "\n\n🐳 Containers: none running";
    } else {
      const formatted = rows.map((row) => {
        const [name, ...statusParts] = row.split("\t");
        const status = statusParts.join(" ");
        const icon = status.toLowerCase().includes("unhealthy") ? "🔴"
          : status.toLowerCase().includes("healthy") ? "🟢"
          : status.toLowerCase().includes("up") ? "🔵"
          : "⚪";
        return `${icon} ${name}: ${status}`;
      });
      containerLines = "\n\n🐳 Containers:\n" + formatted.join("\n");
    }
  } catch {
    containerLines = "\n\n🐳 Containers: unavailable";
  }

  await ctx.reply(
    `📊 Status:\n• Model: ${getModel()}\n• Messages: ${count}\n• Uptime: ${uptime}${containerLines}`
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

// /voice command — toggle voice replies for all messages
bot.command("voice", async (ctx) => {
  voiceReplyEnabled = !voiceReplyEnabled;
  saveVoiceState();
  await ctx.reply(
    voiceReplyEnabled
      ? "🔊 Voice replies: ON — all replies will include a voice message."
      : "🔇 Voice replies: OFF — text-only replies."
  );
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

    if (voiceReplyEnabled) {
      try {
        await ctx.replyWithChatAction("record_voice");
        const oggOut = await synthesize(response);
        await ctx.replyWithVoice(new InputFile(oggOut));
        await cleanupTTS(oggOut);
        // Send text only if response has URLs, code blocks, or links
        if (hasTextContent(response)) {
          const chunks = splitMessage(response, 4096);
          for (const chunk of chunks) {
            await ctx.reply(chunk);
          }
        }
        return;
      } catch (ttsErr) {
        console.error("TTS failed, falling back to text:", ttsErr);
      }
    }

    // Text-only reply (voice off or TTS failed)
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

// Voice message handler
bot.on("message:voice", async (ctx) => {
  const chatId = String(ctx.chat.id);

  await ctx.replyWithChatAction("typing");

  try {
    // Download the voice file
    const file = await ctx.getFile();
    const filePath = file.file_path;
    if (!filePath) throw new Error("Could not get voice file path");

    const url = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download voice: ${res.status}`);

    const oggPath = `/home/pi/AI/data/tmp/${Date.now()}-voice.ogg`;
    const { mkdirSync } = await import("fs");
    mkdirSync("/home/pi/AI/data/tmp", { recursive: true });
    await Bun.write(oggPath, await res.arrayBuffer());

    // Transcribe
    const text = await transcribe(oggPath);
    await (await import("fs/promises")).unlink(oggPath).catch(() => {});

    if (!text) {
      await ctx.reply("Could not transcribe voice message.");
      return;
    }

    // Save and process like a text message
    saveMessage(chatId, "user", text);
    await ctx.replyWithChatAction("typing");

    const response = await runAgent(chatId, text, () => {
      ctx.replyWithChatAction("typing").catch(() => {});
    });

    saveMessage(chatId, "assistant", response);

    if (voiceReplyEnabled) {
      try {
        await ctx.replyWithChatAction("record_voice");
        const oggOut = await synthesize(response);
        await ctx.replyWithVoice(new InputFile(oggOut));
        await cleanupTTS(oggOut);
        if (hasTextContent(response)) {
          const chunks = splitMessage(response, 4096);
          for (const chunk of chunks) {
            await ctx.reply(chunk);
          }
        }
        return;
      } catch (ttsErr) {
        console.error("TTS failed, falling back to text:", ttsErr);
      }
    }

    const chunks = splitMessage(response, 4096);
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Voice error:", msg);
    await ctx.reply(`Error processing voice: ${msg}`);
  }
});

// Returns true if the response contains content that needs to be seen as text
// (URLs, code blocks, file paths, commands, etc.)
function hasTextContent(text: string): boolean {
  return /https?:\/\//.test(text) ||      // URLs
    /```/.test(text) ||                    // code blocks
    /`[^`]+`/.test(text) ||               // inline code
    /\/[\w./-]+\.\w+/.test(text) ||       // file paths
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(text); // IP addresses
}

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
