# Tokei Collector

Python collector that scans local AI tool logs (Claude Code, Codex, Cursor, Gemini CLI) and uploads token usage events to the Tokei Worker.

## Setup

```bash
cd collector
uv sync
uv run tokei-collect --init   # interactive config
uv run tokei-collect doctor   # check state
```

## Configuration

See `~/.tokei/config.toml`:

```toml
device_id = "my-mac"
worker_url = "https://tokei-worker.<subdomain>.workers.dev"
bearer_token = "env:TOKEI_TOKEN"

[parsers]
enabled = ["claude_code", "codex", "cursor", "gemini"]

[parsers.gemini]
outfile = "~/.gemini/telemetry.log"
```

## Install as timer

- **macOS:** `uv run tokei-collect install --launchd`
- **Linux:** `uv run tokei-collect install --systemd`
