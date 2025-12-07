import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { OpenAI } from "openai";
import {
  ensureUser,
  saveMessage,
  getRecentMessages,
  logUsage,
  getUsageSummary
} from "./db.js";

const app = express();
const port = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in .env");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(morgan("dev"));
app.use(express.json());
app.use(
  cors({
    origin: process.env.APP_BASE_URL || `http://localhost:${port}`,
    credentials: true
  })
);
app.use(express.static("public"));

// Simple "auth": userId via header or body; for home use this is fine.
// You can later replace with real auth if you want.
function getUserId(req) {
  return (
    req.header("x-user-id") ||
    (req.body && req.body.userId) ||
    "wife" // default
  );
}

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

// --- API routes ---

// Get recent chat history for UI bootstrap
app.get("/api/history", (req, res) => {
  const userId = req.query.userId || "wife";
  const messages = getRecentMessages(userId, 30);
  res.json({ userId, messages });
});

// Get usage summary (last 30 days)
app.get("/api/usage", (req, res) => {
  const userId = req.query.userId || "wife";
  const summary = getUsageSummary(userId);
  res.json({ userId, summary });
});

// Main chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message, userId: bodyUserId, displayName } = req.body ?? {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing 'message' string" });
    }

    const userId = bodyUserId || getUserId(req);
    ensureUser(userId, displayName || userId);

    // Get recent memory/messages
    const recent = getRecentMessages(userId, 20);

    const systemPrompt = `
You are a friendly, helpful assistant for ${displayName || "the user"}.
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