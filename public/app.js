const API_BASE = "";

const els = {
  chatLog: document.getElementById("chat-log"),
  chatForm: document.getElementById("chat-form"),
  chatText: document.getElementById("chat-text"),
  sendBtn: document.getElementById("send-btn"),
  displayName: document.getElementById("display-name"),
  userId: document.getElementById("user-id"),
  saveProfile: document.getElementById("save-profile"),
  userLabel: document.getElementById("user-label"),
  usageBtn: document.getElementById("usage-btn"),
  usagePanel: document.getElementById("usage-panel"),
  usageContent: document.getElementById("usage-content")
};

const STORAGE_KEY = "chatwrapper_profile";

function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj.displayName) els.displayName.value = obj.displayName;
    if (obj.userId) els.userId.value = obj.userId;
    updateUserLabel();
  } catch {}
}

function saveProfile() {
  const profile = {
    displayName: els.displayName.value.trim() || "You",
    userId: els.userId.value.trim() || "wife"
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  updateUserLabel();
}

function getProfile() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { displayName: "You", userId: "wife" };
  }
  try {
    const obj = JSON.parse(raw);
    return {
      displayName: obj.displayName || "You",
      userId: obj.userId || "wife"
    };
  } catch {
    return { displayName: "You", userId: "wife" };
  }
}

function updateUserLabel() {
  const { displayName, userId } = getProfile();
  els.userLabel.textContent = `${displayName} (${userId})`;
}

// --- rendering ---

function appendMessage(role, content) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.textContent =
    role === "user" ? "You" : role === "assistant" ? "Assistant" : role;
  const body = document.createElement("div");
  body.textContent = content;
  div.appendChild(meta);
  div.appendChild(body);
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function appendSystem(content) {
  const div = document.createElement("div");
  div.className = "msg system";
  div.textContent = content;
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

// --- API helpers ---

async function fetchHistory() {
  const { userId } = getProfile();
  const res = await fetch(`/api/history?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) return;
  const data = await res.json();
  els.chatLog.innerHTML = "";
  (data.messages || []).forEach((m) => {
    appendMessage(m.role, m.content);
  });
}

async function fetchUsage() {
  const { userId } = getProfile();
  const res = await fetch(`/api/usage?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) {
    els.usageContent.textContent = "Unable to load usage.";
    return;
  }
  const data = await res.json();
  const rows = data.summary || [];
  if (!rows.length) {
    els.usageContent.textContent = "No usage yet.";
    return;
  }
  els.usageContent.innerHTML = "";
  rows.forEach((row) => {
    const div = document.createElement("div");
    div.className = "usage-row";
    const left = document.createElement("span");
    left.textContent = row.date;
    const right = document.createElement("span");
    right.textContent = `${(row.cost_usd || 0).toFixed(3)} USD · ${
      row.total_tokens
    } tok`;
    div.appendChild(left);
    div.appendChild(right);
    els.usageContent.appendChild(div);
  });
}

// --- events ---

els.saveProfile.addEventListener("click", () => {
  saveProfile();
  fetchHistory();
  fetchUsage();
});

els.chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = els.chatText.value.trim();
  if (!text) return;
  const { userId, displayName } = getProfile();

  appendMessage("user", text);
  els.chatText.value = "";
  els.sendBtn.disabled = true;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": userId
      },
      body: JSON.stringify({
        message: text,
        userId,
        displayName
      })
    });
    if (!res.ok) {
      appendSystem("Error from server.");
      return;
    }
    const data = await res.json();
    appendMessage("assistant", data.reply || "");
    if (data.usage) {
      const t = data.usage.total_tokens || 0;
      const c = data.estimatedCostUsd || 0;
      appendSystem(`Usage: ${t} tokens · ~$${c.toFixed(4)}`);
      fetchUsage();
    }
  } catch (err) {
    console.error(err);
    appendSystem("Network error.");
  } finally {
    els.sendBtn.disabled = false;
    els.chatText.focus();
  }
});

els.usageBtn.addEventListener("click", () => {
  const visible = !els.usagePanel.classList.contains("hidden");
  if (visible) {
    els.usagePanel.classList.add("hidden");
  } else {
    els.usagePanel.classList.remove("hidden");
    fetchUsage();
  }
});

// auto-grow textarea
els.chatText.addEventListener("input", () => {
  els.chatText.style.height = "auto";
  els.chatText.style.height = Math.min(96, els.chatText.scrollHeight) + "px";
});

// PWA registration
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .catch((err) => console.error("SW reg failed", err));
  });
}

// init
loadProfile();
updateUserLabel();
fetchHistory();
appendSystem("New chat started. Say hi!");
els.chatText.focus();