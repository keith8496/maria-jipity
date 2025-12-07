import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "data", "chatwrapper.db");

// Ensure the data directory exists before opening SQLite
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

// Init schema
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,     -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL
);
`);

export function ensureUser(userId, displayName) {
  const get = db.prepare("SELECT id FROM users WHERE id = ?");
  const exists = get.get(userId);
  if (!exists) {
    db.prepare("INSERT INTO users (id, display_name) VALUES (?, ?)").run(
      userId,
      displayName || userId
    );
  }
}

export function saveMessage(userId, role, content) {
  db.prepare(
    "INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)"
  ).run(userId, role, content);
}

export function getRecentMessages(userId, maxMessages = 20) {
  const stmt = db.prepare(
    "SELECT role, content FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?"
  );
  const rows = stmt.all(userId, maxMessages).reverse();
  return rows.map((r) => ({ role: r.role, content: r.content }));
}

export function logUsage(userId, usage, estimatedCostUsd) {
  const date = new Date().toISOString().slice(0, 10);
  const stmt = db.prepare(`
    INSERT INTO usage_log (user_id, date, input_tokens, output_tokens, total_tokens, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    userId,
    date,
    usage.prompt_tokens || 0,
    usage.completion_tokens || 0,
    usage.total_tokens || 0,
    estimatedCostUsd
  );
}

export function getUsageSummary(userId) {
  const stmt = db.prepare(`
    SELECT date,
           SUM(input_tokens)    AS input_tokens,
           SUM(output_tokens)   AS output_tokens,
           SUM(total_tokens)    AS total_tokens,
           SUM(cost_usd)        AS cost_usd
    FROM usage_log
    WHERE user_id = ?
    GROUP BY date
    ORDER BY date DESC
    LIMIT 30
  `);
  return stmt.all(userId);
}
