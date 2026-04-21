import { Api } from "grammy";
import { markdownToTelegramHtml } from "./format";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const OWNER_CHAT_ID = process.env.OWNER_ID!;

// Use grammy's Api class directly — no Bot instance, no polling conflict
const api = new Api(TOKEN);

/**
 * Send a proactive notification to the boss via Telegram.
 * Used by heartbeat, scheduled tasks, and alerts.
 */
export async function notify(message: string): Promise<void> {
  const html = markdownToTelegramHtml(message);
  try {
    await api.sendMessage(OWNER_CHAT_ID, html, { parse_mode: "HTML" });
  } catch {
    try {
      const plain = html.replace(/<[^>]+>/g, "");
      await api.sendMessage(OWNER_CHAT_ID, plain);
    } catch (err) {
      console.error("Failed to send notification:", err);
    }
  }
}
