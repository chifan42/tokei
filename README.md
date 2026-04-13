# Tokei

AI token usage ambient display. Aggregates token consumption across multiple AI coding tools and renders a live summary on a 4.2" reflective LCD, a web dashboard, or both.

![Tokei](https://img.shields.io/badge/status-running-brightgreen)

## What it does

- Collects token usage from **Claude Code**, **Codex**, **Cursor**, and **Gemini CLI** across multiple devices
- Uploads events to a Cloudflare Worker backed by D1 (SQLite)
- Displays today/month totals, per-tool breakdown, 7-day sparkline, and a daily quote on a Waveshare ESP32-S3-RLCD-4.2 e-ink-like screen
- Web dashboard at `/dashboard` with weekly trends and tool breakdown

## Architecture

```
Devices (N)          Cloudflare           Display
┌──────────┐         ┌──────────┐         ┌──────────┐
│ collector │──POST──>│  Worker  │<──GET───│ ESP32-S3 │
│ (Python)  │ /ingest │  + D1    │ /summary│ RLCD 4.2"│
└──────────┘         └──────────┘         └──────────┘
                          │
                     /dashboard
                     (web browser)
```

## Subsystems

### `worker/` · Cloudflare Worker (TypeScript)

API server with two routes (`POST /v1/ingest`, `GET /v1/summary`), a web dashboard at `/dashboard`, and a daily cron that syncs model prices from LiteLLM.

- **Stack**: TypeScript, Drizzle ORM, Cloudflare D1, oRPC, zod
- **Deploy**: `cd worker && pnpm run ship`

### `collector/` · Log Collector (Python)

Runs on each device via launchd (macOS) or systemd (Linux). Parses local tool logs, uploads events to the worker.

- **Stack**: Python 3.11+, uv, httpx, ruff, pyright
- **Supported tools**:
  - **Claude Code**: `~/.claude/projects/<proj>/<session>.jsonl`
  - **Codex**: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
  - **Cursor**: local bubble history + dashboard API (`cursor.com/api/dashboard/get-filtered-usage-events`)
  - **Gemini CLI**: OTLP telemetry log (requires `telemetry.enabled=true` in `~/.gemini/settings.json`)

### `firmware/` · ESP32-S3 Firmware (C++/Arduino)

Pulls `/v1/summary` every 15 minutes and renders on the 400x300 reflective LCD using LVGL v9.

- **Stack**: PlatformIO, Arduino framework, LVGL v9, ArduinoJson
- **Board**: Waveshare ESP32-S3-RLCD-4.2 (ST7305 driver)
- **Flash**: `cd firmware && pio run -e esp32s3 -t upload`

## Quick Start

### 1. Deploy the Worker

```bash
cd worker
pnpm install
pnpm wrangler login
pnpm wrangler d1 create tokei
# Update wrangler.toml with the database_id
pnpm wrangler secret put TOKEI_BEARER_TOKEN
pnpm run ship
pnpm db:migrate:prod
```

### 2. Install Collector (per device)

```bash
cd collector
uv sync
uv run tokei-collect init    # interactive config
uv run tokei-collect run     # test once
uv run tokei-collect doctor  # verify
```

Install as a timer:
```bash
uv run tokei-collect install --launchd   # macOS
uv run tokei-collect install --systemd   # Linux
```

### 3. Configuration

`~/.tokei/config.toml`:

```toml
device_id = "my-mac"
worker_url = "https://tokei-worker.<subdomain>.workers.dev"
bearer_token = "your-token-here"

[parsers]
enabled = ["claude_code", "codex", "cursor"]

[parsers.cursor]
# Get from browser cookies at cursor.com (WorkosCursorSessionToken value)
dashboard_token = "user_XXXX::eyJhbG..."

[parsers.gemini]
outfile = "~/.gemini/telemetry.log"
```

### 4. Flash Firmware (optional)

```bash
cd firmware
cp include/config.h.example include/config.h
# Edit config.h with your worker URL and bearer token
pio run -e esp32s3 -t upload
```

On first boot, connect to the "Tokei-Setup" WiFi AP from your phone to configure WiFi.

### 5. Web Dashboard

Open `https://tokei-worker.<subdomain>.workers.dev/dashboard` and enter your bearer token.

## Data Sources

| Tool | Source | Auth |
|------|--------|------|
| Claude Code | Local JSONL (`~/.claude/projects/`) | None (local files) |
| Codex | Local JSONL (`~/.codex/sessions/`) | None (local files) |
| Cursor (historical) | Local SQLite (`state.vscdb`) | None (local files) |
| Cursor (recent) | Dashboard API (`cursor.com`) | WorkosCursorSessionToken cookie |
| Gemini CLI | Local OTLP log | None (requires telemetry opt-in) |

## Pricing

Token costs are computed using the [LiteLLM model price table](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json), synced daily via cron. Unknown models fall back to `claude-opus-4-6` pricing (conservative overestimate).

## License

MIT

## Preview

<img width="854" height="715" alt="image" src="https://github.com/user-attachments/assets/97fb86e1-15ca-4326-8754-0f32aee0dd18" />

