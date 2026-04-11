# Tokei

AI token usage ambient display. Reads token usage from local AI tool logs, uploads to a Cloudflare Worker, renders a summary on an e-ink screen.

## Subsystems

- `worker/` · Cloudflare Worker + D1 backend (TypeScript)
- `collector/` · Per-device log collector (Python, not yet implemented)
- `firmware/` · ESP32-S3 RLCD firmware (Arduino + LVGL, not yet implemented)

## Spec

See `docs/superpowers/specs/2026-04-11-tokei-design.md`.
