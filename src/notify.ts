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
