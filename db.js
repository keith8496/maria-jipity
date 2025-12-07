import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "data", "chatwrapper.db");

// Ensure the data directory exists beore opening SQLite
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

// Init schema
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,         -- internal user id (e.g. "wife", "keith")
  display_name TEXT,
  username TEXT UNIQUE,        -- login username
  password_hash TEXT,          -- bcrypt hash
  is_admin INTEGER DEFAULT 0   -- 0 = normal, 1 = admin
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

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,           -- opaque session token
  user_id TEXT NOT NULL,         -- references users.id
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
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

//
// ---- Authentication Helpers ----
//

// Create a new user with username/password_hash/is_admin
export function createUser(id, displayName, username, passwordHash, isAdmin = 0) {
  const stmt = db.prepare(`
    INSERT INTO users (id, display_name, username, password_hash, is_admin)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, displayName, username, passwordHash, isAdmin);
}

// Retrieve user by username (for login)
export function getUserByUsername(username) {
  const stmt = db.prepare(`
    SELECT id, display_name, username, password_hash, is_admin
    FROM users
    WHERE username = ?
  `);
  return stmt.get(username);
}

// Retrieve user by internal id
export function getUserById(id) {
  const stmt = db.prepare(`
    SELECT id, display_name, username, password_hash, is_admin
    FROM users
    WHERE id = ?
  `);
  return stmt.get(id);
}

// Create a new session token for a user
export function createSession(sessionId, userId, expiresAt) {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (?, ?, ?)
  `);
  stmt.run(sessionId, userId, expiresAt);
}

// Delete a session (logout)
export function deleteSession(sessionId) {
  const stmt = db.prepare(`DELETE FROM sessions WHERE id = ?`);
  stmt.run(sessionId);
}

// Lookup a session + return user object if valid
export function getUserBySessionId(sessionId) {
  const stmt = db.prepare(`
    SELECT u.id, u.display_name, u.username, u.is_admin
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP
  `);
  return stmt.get(sessionId);
}

// List all users (admin only)
export function listUsers() {
  const stmt = db.prepare(`
    SELECT id, display_name, username, is_admin
    FROM users
    ORDER BY username ASC
  `);
  return stmt.all();
}