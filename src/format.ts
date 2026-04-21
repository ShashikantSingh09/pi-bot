/**
 * Convert markdown response to Telegram HTML.
 * Telegram supports: <b>, <i>, <code>, <pre>, <s>, <a href="">, <tg-spoiler>
 */

// Escape HTML entities first, then apply formatting
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function markdownToTelegramHtml(text: string): string {
  // Split by code blocks first to avoid processing inside them
  const parts = text.split(/(```[\s\S]*?```)/g);

  const processed = parts.map((part, i) => {
    // Odd indices are code blocks
    if (i % 2 === 1) {
      const match = part.match(/```(\w*)\n?([\s\S]*?)```/);
      if (match) {
        const lang = match[1];
        const code = escapeHtml(match[2].trim());
        return lang
          ? `<pre><code class="language-${lang}">${code}</code></pre>`
          : `<pre>${code}</pre>`;
      }
      return part;
    }

    let result = escapeHtml(part);

    // Remove markdown headers (## Header -> just the text, bold)
    result = result.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

    // Bold: **text** or __text__
    result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    result = result.replace(/__(.+?)__/g, "<b>$1</b>");

    // Italic: *text* or _text_ (but not inside words with underscores)
    result = result.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<i>$1</i>");
    result = result.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<i>$1</i>");

    // Strikethrough: ~~text~~
    result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

    // Inline code: `text`
    result = result.replace(/`([^`]+?)`/g, "<code>$1</code>");

    // Links: [text](url)
    result = result.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, '<a href="$2">$1</a>');

    // Bullet points: convert "- item" or "* item" to "• item"
    result = result.replace(/^[\s]*[-*]\s+/gm, "• ");

    return result;
  });

  return processed.join("").trim();
}

/**
 * Send a reply with HTML formatting. Falls back to plain text if HTML fails.
 */
export async function sendFormattedReply(
  ctx: any,
  text: string
): Promise<void> {
  const html = markdownToTelegramHtml(text);
  const chunks = splitMessage(html, 4000);

  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: "HTML" });
    } catch {
      // If HTML parsing fails, send as plain text (strip HTML tags)
      const plain = chunk.replace(/<[^>]+>/g, "");
      await ctx.reply(plain);
    }
  }
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
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt <= 0) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
