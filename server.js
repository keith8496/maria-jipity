import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { OpenAI } from "openai";
import crypto from "crypto";
import cookie from "cookie";
import bcrypt from "bcryptjs";
import {
  ensureUser,
  saveMessage,
  getRecentMessages,
  logUsage,
  getUsageSummary,
  createUser,
  getUserByUsername,
  createSession,
  deleteSession,
  getUserBySessionId,
  listUsers,
  updateUserPassword,
  deleteUser,
  deleteSessionsForUser
} from "./db.js";

// --- Simple in-memory rate limiting (alpha) ---
// NOTE: This is per-process only. For multi-instance deployments,
// move this to Redis or another shared store.
const LOGIN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const LOGIN_MAX_PER_IP = 50;           // max login attempts per IP per window
const LOGIN_MAX_PER_USER = 20;         // max login attempts per username per window

const CHAT_WINDOW_MS = 60 * 1000;      // 60 seconds
const CHAT_MAX_PER_USER = 60;          // max chat calls per user per window

const loginAttemptsByIp = new Map();
const loginAttemptsByUser = new Map();
const chatAttemptsByUser = new Map();

function getClientIp(req) {
  // If behind a reverse proxy, X-Forwarded-For is preferred (once trust proxy is set).
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.ip || "unknown";
}

function checkAndUpdateRateLimit(map, key, windowMs, maxCount) {
  const now = Date.now();
  let entry = map.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 0 };
  }
  entry.count += 1;
  map.set(key, entry);
  return entry.count > maxCount;
}

const app = express();

app.set("trust proxy", 1);

const port = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in .env");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const useSecureCookies = process.env.COOKIE_SECURE === "true";

// Bootstrap: create an initial admin user if no users exist.
// This runs once at startup and logs the generated password.
(async () => {
  try {
    const existing = listUsers();
    console.log("Existing users at startup:", existing);
    if (!existing || existing.length === 0) {
      const adminPassword = crypto.randomBytes(12).toString("base64url").slice(0, 16);
      const passwordHash = bcrypt.hashSync(adminPassword, 10);
      createUser("admin", "Administrator", "admin", passwordHash, 1);
      console.log("### Initial admin user created ###");
      console.log("   username: admin");
      console.log("   password:", adminPassword);
      console.log("Please change this password after first login.");
    }
  } catch (err) {
    console.error("Error bootstrapping admin user:", err);
  }
})();

app.use(morgan("dev"));
app.use(express.json());
app.use(
  cors({
    origin: process.env.APP_BASE_URL || `http://localhost:${port}`,
    credentials: true
  })
);
app.use(express.static("public"));

app.use(authMiddleware);

// --- Auth helpers ---

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return cookie.parse(header);
}

function authMiddleware(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const sid = cookies.sid;
    if (!sid) {
      req.user = null;
      return next();
    }
    const user = getUserBySessionId(sid);
    if (!user) {
      req.user = null;
      return next();
    }
    req.user = {
      id: user.id,
      displayName: user.display_name,
      username: user.username,
      isAdmin: !!user.is_admin
    };
    next();
  } catch (err) {
    console.error("authMiddleware error:", err);
    req.user = null;
    next();
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

// --- API routes ---

// Auth: login
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Missing username or password" });
  }

  // Rate limiting: brute force protection
  const ip = getClientIp(req);
  const normalizedUsername = String(username).toLowerCase();

  const ipLimited = checkAndUpdateRateLimit(
    loginAttemptsByIp,
    ip,
    LOGIN_WINDOW_MS,
    LOGIN_MAX_PER_IP
  );
  const userLimited = checkAndUpdateRateLimit(
    loginAttemptsByUser,
    normalizedUsername,
    LOGIN_WINDOW_MS,
    LOGIN_MAX_PER_USER
  );

  if (ipLimited || userLimited) {
    return res
      .status(429)
      .json({ error: "Too many login attempts. Please try again later." });
  }

  const user = getUserByUsername(username);
  if (!user || !user.password_hash) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const sessionId = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  createSession(sessionId, user.id, expiresAt);

  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookies,
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  };

  res.setHeader("Set-Cookie", cookie.serialize("sid", sessionId, cookieOptions));
  res.json({
    user: {
      id: user.id,
      displayName: user.display_name,
      username: user.username,
      isAdmin: !!user.is_admin
    }
  });
});

// Auth: logout
app.post("/api/auth/logout", (req, res) => {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  if (sid) {
    deleteSession(sid);
  }

  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookies,
    path: "/",
    maxAge: 0
  };

  res.setHeader("Set-Cookie", cookie.serialize("sid", "", cookieOptions));
  res.json({ ok: true });
});

// Auth: current user
app.get("/api/auth/me", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({
    user: {
      id: req.user.id,
      displayName: req.user.displayName,
      username: req.user.username,
      isAdmin: !!req.user.isAdmin
    }
  });
});

// Auth: change password (current user)
app.post("/api/auth/password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res
      .status(400)
      .json({ error: "Current password and new password are required." });
  }
  if (newPassword.length < 8) {
    return res
      .status(400)
      .json({ error: "New password must be at least 8 characters long." });
  }

  try {
    const user = getUserByUsername(req.user.username);
    if (!user || !user.password_hash) {
      return res.status(500).json({ error: "User not found." });
    }

    const ok = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    updateUserPassword(user.id, newHash);

    // Invalidate existing sessions and create a fresh one
    deleteSessionsForUser(user.id);
    const sessionId = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(
      Date.now() + 1000 * 60 * 60 * 24 * 30
    ).toISOString();
    createSession(sessionId, user.id, expiresAt);

    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax",
      secure: useSecureCookies,
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    };

    res.setHeader("Set-Cookie", cookie.serialize("sid", sessionId, cookieOptions));
    return res.json({ ok: true });
  } catch (err) {
    console.error("Change password error:", err);
    return res.status(500).json({ error: "Failed to change password." });
  }
});

// Admin: list users
app.get("/api/admin/users", requireAdmin, (req, res) => {
  const users = listUsers();
  res.json({
    users: users.map((u) => ({
      id: u.id,
      displayName: u.display_name,
      username: u.username,
      isAdmin: !!u.is_admin
    }))
  });
});

// Admin: create user
app.post("/api/admin/users", requireAdmin, (req, res) => {
  const { id, displayName, username, password, isAdmin } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Missing username or password" });
  }
  const internalId = id || username;
  const hash = bcrypt.hashSync(password, 10);
  try {
    createUser(internalId, displayName || username, username, hash, isAdmin ? 1 : 0);
    return res.status(201).json({
      user: {
        id: internalId,
        displayName: displayName || username,
        username,
        isAdmin: !!isAdmin
      }
    });
  } catch (err) {
    console.error("Error creating user:", err);
    return res.status(400).json({ error: "Failed to create user" });
  }
});

// Admin: delete user
app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: "Missing user id." });
  }

  // Prevent admin from deleting their own account
  if (id === req.user.id) {
    return res
      .status(400)
      .json({ error: "You cannot delete your own account." });
  }

  try {
    // Optionally, verify user exists
    const users = listUsers();
    const target = users.find((u) => u.id === id);
    if (!target) {
      return res.status(404).json({ error: "User not found." });
    }

    deleteSessionsForUser(id);
    deleteUser(id);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting user:", err);
    return res.status(500).json({ error: "Failed to delete user." });
  }
});

// Get recent chat history for UI bootstrap
app.get("/api/history", requireAuth, (req, res) => {
  const userId = req.user.id;
  const messages = getRecentMessages(userId, 30);
  res.json({ userId, messages });
});

// Get usage summary (last 30 days)
app.get("/api/usage", requireAuth, (req, res) => {
  const userId = req.user.id;
  const summary = getUsageSummary(userId);
  res.json({ userId, summary });
});

// Main chat endpoint
app.post("/api/chat", requireAuth, async (req, res) => {
  try {
    const { message } = req.body ?? {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing 'message' string" });
    }

    const userId = req.user.id;

    // Per-user chat rate limiting to avoid abuse
    const chatLimited = checkAndUpdateRateLimit(
      chatAttemptsByUser,
      userId,
      CHAT_WINDOW_MS,
      CHAT_MAX_PER_USER
    );
    if (chatLimited) {
      return res
        .status(429)
        .json({ error: "Too many requests. Please slow down." });
    }

    const displayName = req.user.displayName || req.user.username || "the user";
    ensureUser(userId, displayName);

    // Get recent memory/messages
    const recent = getRecentMessages(userId, 20);

    const systemPrompt = `
You are a friendly, helpful assistant for ${displayName}.
Keep responses concise but clear. Use plain language. 
You are running inside a lightweight personal web wrapper.
    `.trim();

    const messages = [
      { role: "system", content: systemPrompt },
      ...recent,
      { role: "user", content: message }
    ];

    saveMessage(userId, "user", message);

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0.4
    });

    const reply =
      completion.choices?.[0]?.message?.content ||
      "Sorry, I couldn't produce a response.";

    saveMessage(userId, "assistant", reply);

    const usage = completion.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };
    const costUsd = estimateCostUsd(usage);
    logUsage(userId, usage, costUsd);

    res.json({
      reply,
      usage,
      estimatedCostUsd: costUsd
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Chat wrapper listening on http://localhost:${port}`);
});

// Estimate cost for gpt-4o-mini (adjust if you change model)
function estimateCostUsd(usage) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const pt = usage.prompt_tokens || 0;
  const ct = usage.completion_tokens || 0;

  // ballpark 2025-ish: gpt-4o-mini ~ $0.15 / 1M input, $0.60 / 1M output
  const inputRate = 0.15 / 1_000_000;
  const outputRate = 0.6 / 1_000_000;

  return pt * inputRate + ct * outputRate;
}