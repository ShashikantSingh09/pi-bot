import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(import.meta.dir, "..", "data");
const DB_PATH = process.env.DB_PATH ?? join(DATA_DIR, "planetagent.db");

mkdirSync(DATA_DIR, { recursive: true });

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
