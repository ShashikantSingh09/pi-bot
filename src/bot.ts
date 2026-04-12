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
