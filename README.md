# maria-jipity  
A private, self-hosted ChatGPT wrapper designed for personal or family use.  
Built for Courtney — and anyone who wants a safe, controlled, cost‑transparent AI assistant.

---

## ✨ Overview
**maria-jipity** is a lightweight web UI + backend server that provides:
- A friendly ChatGPT-like chat interface  
- Per-user accounts (admin + non-admin)
- Persistent message history (stored in SQLite)
- Usage tracking (tokens + estimated cost)
- Optional long‑term memory system (future enhancement)
- Zero external dependencies besides the OpenAI API

The project is intentionally simple, transparent, and safe for family use.  
You control *everything* — the API key, the users, the server, and the data.

---

## 🏗️ Architecture
- **Frontend:** Vanilla HTML/CSS/JS (mobile-first, lightweight, fast)  
- **Backend:** Node.js + Express  
- **Database:** SQLite (local file)  
- **AI Provider:** OpenAI API (GPT‑4o‑mini by default, configurable)  
- **Runtime:** Docker container (recommended)  
- **Deployment:** Behind a reverse proxy (nginx / Caddy / Traefik)

The backend stores:
- Users
- Sessions
- Chat messages
- Usage summaries

All data stays on your server.

---

## 🔐 Authentication & Admin User
When maria-jipity starts for the first time (empty DB), it automatically creates:

**Admin username:** `admin`  
**Admin password:** printed **once** in the server logs at startup

Example:
```text
[bootstrap] Created admin user
username: admin
password: 4hfj28f92jfs9023f
```

After logging in:
- Go to **Admin → Change my password** to set your own secure admin password.
- Create your normal day-to-day user accounts.
- Optional: disable or ignore the bootstrap admin afterward.

---

## 🌐 Reverse Proxy Assumptions
This application is intended to run **behind a reverse proxy** such as:
- Caddy
- nginx
- Traefik
- Cloudflare Tunnel

The proxy *must*:
- Terminate HTTPS
- Forward `X-Forwarded-For` and `X-Forwarded-Proto`
- Route traffic to the container on port `3000`

Example nginx snippet:
```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

The server uses `app.set("trust proxy", 1)` so rate-limiting and sessions receive the correct IP.

---

## 🐳 Docker Deployment
Production deployment is expected to use Docker.

### Example `Dockerfile`
```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

EXPOSE 3000
CMD ["npm", "start"]
```

### Recommended `docker-compose.yml`
```yaml
services:
  maria-jipity:
    image: maria-jipity:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      NODE_ENV: production
      COOKIE_SECURE: "true"
    volumes:
      - ./data:/app/data
```

Ensure `./data` exists so SQLite persists across restarts.

---

## 🔧 Environment Variables
The app is configured entirely via environment variables.

| Variable | Required | Description |
|---------|----------|-------------|
| `OPENAI_API_KEY` | **Yes** | API key used for all chat requests |
| `OPENAI_MODEL` | No | Default: `gpt-4o-mini` |
| `COOKIE_SECURE` | No | `true` when behind HTTPS |
| `PORT` | No | Defaults to `3000` |
| `NODE_ENV` | No | Should be `production` in Docker |

Example `.env` for local dev:
```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
COOKIE_SECURE=false
```

---

## 💾 Data Storage
All persistent data is stored in:

```text
/app/data/chatwrapper.db
```

Inside the database are the tables:
- `users`
- `sessions`
- `messages`
- `usage`

It is safe to back up this file directly.

---

## 🚀 Development Workflow
```bash
npm install
npm start
```

Environment variables load from `.env` during dev.

SQLite file defaults to:
```text
./chatwrapper.db
```

---

## 🔮 Future Enhancements
Planned / optional features:
- Long-term user memory (summaries stored in DB and injected at runtime)
- Persona-based system prompts
- Theming improvements
- Chat export
- Admin usage caps / alerts

---

## 📜 License
Private project. No redistribution.

---

## ❤️ About
Written by Keith and Ed — built with love for Courtney.  
Lightweight, transparent, and completely yours.
