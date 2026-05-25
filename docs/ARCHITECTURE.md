# StreamRelay IPTV Platform — Architecture

## Overview

StreamRelay is a lightweight, production-grade IPTV relay platform designed for legal content redistribution within private networks or authorized distribution. It mirrors the operational model of commercial panel systems while remaining open, auditable, and resource-efficient.

**Core principle:** Copy streams without re-encoding by default (`-c copy`), preserving source quality and minimizing CPU usage.

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                        │
│   Web Dashboard (React)  │  IPTV Players  │  Mobile Apps  │  API Clients  │
└──────────────┬───────────────────────────┬──────────────────┬─────────────┘
               │ HTTPS                     │ HLS/MPEGTS       │ REST + JWT
               ▼                           ▼                  ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         NGINX (Reverse Proxy + RTMP + HLS)                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │ SSL/TLS     │  │ Rate Limit   │  │ Hotlink     │  │ Signed URL       │   │
│  │ Termination │  │ + IP Filter  │  │ Protection  │  │ Validation       │   │
│  └─────────────┘  └──────────────┘  └─────────────┘  └──────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ RTMP Ingest (:1935)  →  HLS Output (/hls/)  →  MPEGTS (/mpegts/)       │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────┬───────────────────────────────┬───────────────────────────────┘
               │ /api/*                        │ Internal
               ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────────────────────┐
│   API SERVER (Node.js)       │   │   STREAM ENGINE                          │
│   Fastify + JWT + Validation │   │   FFmpeg Relay Processes (per channel)   │
│   ┌────────────────────────┐ │   │   ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│   │ Auth & Users           │ │   │   │ Channel 1│ │ Channel 2│ │ Channel N│ │
│   │ Channel Management     │◄┼───┼──►│ FFmpeg   │ │ FFmpeg   │ │ FFmpeg  │ │
│   │ Stream Control         │ │   │   └──────────┘ └──────────┘ └─────────┘ │
│   │ Signed URL Generator   │ │   └──────────────────────────────────────────┘
│   │ System Metrics         │ │                    ▲
│   └────────────────────────┘ │                    │
└──────────────┬───────────────┘   ┌────────────────┴─────────────────────────┐
               │                   │   WATCHDOG + HEALTH MONITOR              │
               │                   │   Auto-restart │ Stream probes │ Alerts   │
               │                   └────────────────────────────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌──────────────┐
│Postgres│ │ Redis  │ │ Bull Queue   │
│  DB    │ │ Cache  │ │ Job Workers  │
└────────┘ └────────┘ └──────────────┘
```

---

## Multi-Server / Load Balancing Architecture

```
                    ┌─────────────────┐
                    │  Load Balancer  │
                    │  (Nginx/HAProxy)│
                    └────────┬────────┘
           ┌─────────────────┼─────────────────┐
           ▼                 ▼                 ▼
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │  Node 1     │   │  Node 2     │   │  Node 3     │
    │  API+Stream │   │  API+Stream │   │  Stream Only│
    └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
           │                 │                 │
           └─────────────────┼─────────────────┘
                             ▼
              ┌──────────────────────────┐
              │  Shared PostgreSQL + Redis│
              │  (Central state & queue)  │
              └──────────────────────────┘
```

---

## Streaming Pipeline

```
INPUT SOURCES                    RELAY ENGINE                    OUTPUT FORMATS
─────────────                    ────────────                    ──────────────

M3U Playlist ──────┐
HLS (.m3u8) ───────┤
RTMP Push ─────────┤──►  FFmpeg (-c copy)  ──►  HLS segments (/hls/{id}/)
UDP Multicast ─────┤         │                    MPEGTS (/mpegts/{id}.ts)
HTTP Stream ───────┘         │
                             ├──► Optional Transcode Profile
                             │    (libx264/aac when enabled)
                             │
                             └──► Internal Relay (pipe to another channel)
```

### FFmpeg Relay Command (Default — No Transcode)

```bash
ffmpeg -hide_banner -loglevel warning \
  -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
  -i "{SOURCE_URL}" \
  -c copy \
  -f hls -hls_time 4 -hls_list_size 6 -hls_flags delete_segments+append_list \
  /var/www/hls/{channel_id}/index.m3u8
```

### Health Check Flow

```
Every 30s:
  1. Probe HLS manifest (HTTP HEAD/GET)
  2. Check FFmpeg process alive (PID)
  3. Validate segment freshness (< 10s old)
  4. If FAIL → increment failure_count
  5. If failure_count >= 3 → restart channel (via queue)
  6. Log event → stream_logs table
```

---

## Component Responsibilities

| Component        | Role                                              |
|-----------------|---------------------------------------------------|
| **API Server**   | REST API, JWT auth, business logic, URL signing   |
| **Stream Engine**| FFmpeg process lifecycle per channel              |
| **Watchdog**     | Process supervision, crash recovery               |
| **Health Monitor**| Stream quality probes, auto-restart             |
| **Worker**       | Async jobs (restart, import M3U, cleanup)         |
| **Nginx**        | RTMP ingest, HLS serve, reverse proxy, security   |
| **PostgreSQL**   | Persistent data (users, channels, logs, tokens)   |
| **Redis**        | Sessions, rate limits, cache, Bull queue          |
| **Frontend**     | React dashboard, player, monitoring UI            |

---

## Security Layers

1. **JWT Authentication** — Access + refresh tokens
2. **API Tokens** — Scoped programmatic access
3. **Signed Expiring URLs** — HMAC-SHA256, time-limited stream access
4. **Rate Limiting** — Redis-backed per IP/user
5. **IP Allow/Deny Lists** — Per user and global
6. **Hotlink Protection** — Referer validation on stream endpoints
7. **Secure Headers** — HSTS, CSP, X-Frame-Options via Helmet
8. **Input Validation** — Zod schemas on all endpoints
9. **SQL Injection** — Parameterized queries via pg driver
10. **Secrets** — Environment variables, never committed

---

## Database Entity Relationships

```
users ──────┬──── api_tokens
            ├──── user_permissions
            └──── stream_access (allowed channels)

channels ───┬──── stream_sessions (active FFmpeg PIDs)
            ├──── stream_logs
            └──── channel_categories

servers ──── server_nodes (multi-server registry)

system ───── settings, audit_logs
```

---

## Scalability Notes

- **Horizontal:** Add stream-only nodes; register in `servers` table; LB routes by channel assignment
- **Vertical:** Each FFmpeg relay uses ~1-5% CPU (copy mode); 100 channels ≈ 2-4 cores
- **Caching:** Redis caches channel lists, signed URL validation, system stats (TTL 5-30s)
- **Queue:** Bull handles restart storms, M3U imports, log rotation without blocking API

---

## Technology Stack

| Layer      | Technology                          |
|-----------|-------------------------------------|
| Backend   | Node.js 20, Fastify, pg, Bull, Pino |
| Frontend  | React 18, Vite, TailwindCSS, hls.js |
| Database  | PostgreSQL 16                       |
| Cache/Queue| Redis 7                            |
| Streaming | FFmpeg 6, Nginx RTMP Module         |
| Container | Docker Compose                      |
