const API_BASE = "";

let currentUser = null;

const els = {
  // Top bar
  userLabel: document.getElementById("user-label"),
  logoutBtn: document.getElementById("logout-btn"),

  // Tabs
  tabChat: document.getElementById("tab-chat"),
  tabUsage: document.getElementById("tab-usage"),
  tabAdmin: document.getElementById("tab-admin"),

  // Panels
  panelChat: document.getElementById("panel-chat"),
  panelUsage: document.getElementById("panel-usage"),
  panelAdmin: document.getElementById("panel-admin"),

  // Chat
  chatLog: document.getElementById("chat-log"),
  chatForm: document.getElementById("chat-form"),
  chatText: document.getElementById("chat-text"),
  sendBtn: document.getElementById("send-btn"),

  // Usage
  usageContent: document.getElementById("usage-content"),

  // Admin
  adminUsers: document.getElementById("admin-users"),
  adminCreateUserForm: document.getElementById("admin-create-user-form"),
  adminNewUsername: document.getElementById("admin-new-username"),
  adminNewDisplayname: document.getElementById("admin-new-displayname"),
  adminNewPassword: document.getElementById("admin-new-password"),
  adminNewIsAdmin: document.getElementById("admin-new-isadmin"),
  adminError: document.getElementById("admin-error"),

  // Login overlay
  loginOverlay: document.getElementById("login-overlay"),
  loginForm: document.getElementById("login-form"),
  loginUsername: document.getElementById("login-username"),
  loginPassword: document.getElementById("login-password"),
  loginError: document.getElementById("login-error")
};

// --- UI helpers ---

function setUserLabel() {
  if (!currentUser) {
    els.userLabel.textContent = "Not signed in";
    return;
  }
  const name =
    currentUser.displayName ||
    currentUser.username ||
    currentUser.id ||
    "User";
  const roleLabel = currentUser.isAdmin ? "admin" : "user";
  els.userLabel.textContent = `${name} (${roleLabel})`;
}

function showLoginOverlay() {
  els.loginOverlay.classList.remove("hidden");
  els.logoutBtn.classList.add("hidden");
  els.tabAdmin.classList.add("hidden");
  currentUser = null;
  setUserLabel();
  clearChat();
  clearUsage();
  clearAdminUsers();
  els.loginError.classList.add("hidden");
  els.loginError.textContent = "";
  if (els.loginUsername) els.loginUsername.focus();
}

function hideLoginOverlay() {
  els.loginOverlay.classList.add("hidden");
}

function clearChat() {
  if (els.chatLog) {
    els.chatLog.innerHTML = "";
  }
}

function clearUsage() {
  if (els.usageContent) {
    els.usageContent.innerHTML = "";
  }
}

function clearAdminUsers() {
  if (els.adminUsers) {
    els.adminUsers.innerHTML = "";
  }
}

function setTabsForUser() {
  // Logout button only visible when authenticated
  if (currentUser) {
    els.logoutBtn.classList.remove("hidden");
  } else {
    els.logoutBtn.classList.add("hidden");
  }

  // Admin tab visible only for admins
  if (currentUser && currentUser.isAdmin) {
    els.tabAdmin.classList.remove("hidden");
  } else {
    els.tabAdmin.classList.add("hidden");
  }
}

function activateTab(tabName) {
  const tabs = {
    chat: { button: els.tabChat, panel: els.panelChat },
    usage: { button: els.tabUsage, panel: els.panelUsage },
    admin: { button: els.tabAdmin, panel: els.panelAdmin }
  };

  Object.keys(tabs).forEach((key) => {
    const { button, panel } = tabs[key];
    if (!button || !panel) return;
    if (key === tabName) {
      button.classList.add("active");
      panel.classList.remove("hidden");
      panel.classList.add("active");
    } else {
      button.classList.remove("active");
      panel.classList.add("hidden");
      panel.classList.remove("active");
    }
  });

  // Lazy load usage/admin when their tab is opened
  if (tabName === "usage" && currentUser) {
    fetchUsage();
  } else if (tabName === "admin" && currentUser && currentUser.isAdmin) {
    fetchAdminUsers();
  }
}

// --- Rendering ---

function appendMessage(role, content) {
  if (!els.chatLog) return;
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
  if (!els.chatLog) return;
  const div = document.createElement("div");
  div.className = "msg system";
  div.textContent = content;
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

// --- API helper ---

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (res.status === 401) {
    showLoginOverlay();
    throw new Error("Not authenticated");
  }

  const text = await res.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// --- Backend calls ---

async function checkAuthOnLoad() {
  try {
    const res = await fetch(API_BASE + "/api/auth/me", {
      credentials: "include"
    });
    if (res.status === 401) {
      showLoginOverlay();
      return;
    }
    if (!res.ok) {
      showLoginOverlay();
      return;
    }
    const data = await res.json();
    currentUser = data.user || null;
    setUserLabel();
    setTabsForUser();
    hideLoginOverlay();
    clearChat();
    appendSystem("Welcome back.");
    await fetchHistory();
    await fetchUsage();
    activateTab("chat");
    if (els.chatText) {
      els.chatText.focus();
    }
  } catch (err) {
    console.error("checkAuthOnLoad error:", err);
    showLoginOverlay();
  }
}

async function fetchHistory() {
  try {
    const data = await api("/api/history");
    if (!data || !data.messages || !els.chatLog) return;
    els.chatLog.innerHTML = "";
    (data.messages || []).forEach((m) => {
      appendMessage(m.role, m.content);
    });
  } catch (err) {
    console.error("fetchHistory error:", err);
  }
}

async function fetchUsage() {
  if (!els.usageContent) return;
  try {
    const data = await api("/api/usage");
    if (!data) {
      els.usageContent.textContent = "Unable to load usage.";
      return;
    }
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
  } catch (err) {
    console.error("fetchUsage error:", err);
    els.usageContent.textContent = "Unable to load usage.";
  }
}

async function fetchAdminUsers() {
  if (!els.adminUsers) return;
  try {
    const data = await api("/api/admin/users");
    if (!data || !Array.isArray(data.users)) {
      els.adminUsers.textContent = "Unable to load users.";
      return;
    }
    els.adminUsers.innerHTML = "";
    if (!data.users.length) {
      els.adminUsers.textContent = "No users yet.";
      return;
    }
    data.users.forEach((u) => {
      const row = document.createElement("div");
      row.className = "admin-user-row";
      const left = document.createElement("span");
      left.textContent = `${u.username} — ${u.displayName || u.id}`;
      const right = document.createElement("span");
      right.textContent = u.isAdmin ? "admin" : "user";
      row.appendChild(left);
      row.appendChild(right);
      els.adminUsers.appendChild(row);
    });
  } catch (err) {
    console.error("fetchAdminUsers error:", err);
    els.adminUsers.textContent = "Unable to load users.";
  }
}

// --- Event wiring ---

// Login
if (els.loginForm) {
  els.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = els.loginUsername.value.trim();
    const password = els.loginPassword.value;
    if (!username || !password) {
      els.loginError.textContent = "Enter username and password.";
      els.loginError.classList.remove("hidden");
      return;
    }
    els.loginError.classList.add("hidden");
    els.loginError.textContent = "";

    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      if (!data || !data.user) {
        els.loginError.textContent = "Invalid credentials.";
        els.loginError.classList.remove("hidden");
        return;
      }
      currentUser = data.user;
      setUserLabel();
      setTabsForUser();
      hideLoginOverlay();
      clearChat();
      appendSystem("Signed in.");
      await fetchHistory();
      await fetchUsage();
      activateTab("chat");
      if (els.chatText) {
        els.chatText.focus();
      }
    } catch (err) {
      console.error("login error:", err);
      els.loginError.textContent = "Login failed.";
      els.loginError.classList.remove("hidden");
    }
  });
}

// Logout
if (els.logoutBtn) {
  els.logoutBtn.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (err) {
      console.error("logout error:", err);
    } finally {
      currentUser = null;
      setUserLabel();
      setTabsForUser();
      showLoginOverlay();
    }
  });
}

// Tabs
if (els.tabChat) {
  els.tabChat.addEventListener("click", () => activateTab("chat"));
}
if (els.tabUsage) {
  els.tabUsage.addEventListener("click", () => activateTab("usage"));
}
if (els.tabAdmin) {
  els.tabAdmin.addEventListener("click", () => activateTab("admin"));
}

// Chat submit
if (els.chatForm) {
  els.chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = els.chatText.value.trim();
    if (!text) return;
    if (!currentUser) {
      showLoginOverlay();
      return;
    }

    appendMessage("user", text);
    els.chatText.value = "";
    els.sendBtn.disabled = true;

    try {
      const data = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text })
      });
      if (!data || !data.reply) {
        appendSystem("Error from server.");
        return;
      }
      appendMessage("assistant", data.reply || "");
      if (data.usage) {
        const t = data.usage.total_tokens || 0;
        const c = data.estimatedCostUsd || 0;
        appendSystem(`Usage: ${t} tokens · ~$${c.toFixed(4)}`);
        fetchUsage();
      }
    } catch (err) {
      console.error(err);
      appendSystem("Network or auth error.");
    } finally {
      els.sendBtn.disabled = false;
      els.chatText.focus();
    }
  });
}

// Admin create user
if (els.adminCreateUserForm) {
  els.adminCreateUserForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser || !currentUser.isAdmin) {
      return;
    }
    const username = els.adminNewUsername.value.trim();
    const displayName = els.adminNewDisplayname.value.trim();
    const password = els.adminNewPassword.value;
    const isAdmin = els.adminNewIsAdmin.checked;

    if (!username || !password) {
      els.adminError.textContent = "Username and password are required.";
      els.adminError.classList.remove("hidden");
      return;
    }

    els.adminError.classList.add("hidden");
    els.adminError.textContent = "";

    try {
      const data = await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username,
          displayName,
          password,
          isAdmin
        })
      });
      if (!data || !data.user) {
        els.adminError.textContent = "Failed to create user.";
        els.adminError.classList.remove("hidden");
        return;
      }
      els.adminNewUsername.value = "";
      els.adminNewDisplayname.value = "";
      els.adminNewPassword.value = "";
      els.adminNewIsAdmin.checked = false;
      await fetchAdminUsers();
    } catch (err) {
      console.error("admin create user error:", err);
      els.adminError.textContent = "Failed to create user.";
      els.adminError.classList.remove("hidden");
    }
  });
}

// auto-grow textarea
if (els.chatText) {
  els.chatText.addEventListener("input", () => {
    els.chatText.style.height = "auto";
    els.chatText.style.height =
      Math.min(96, els.chatText.scrollHeight) + "px";
  });
}

// PWA registration
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .catch((err) => console.error("SW reg failed", err));
  });
}

// init
(async function init() {
  setUserLabel();
  await checkAuthOnLoad();
})();