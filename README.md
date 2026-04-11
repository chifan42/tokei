# Tokei

AI token usage ambient display. Reads token usage from local AI tool logs, uploads to a Cloudflare Worker, renders a summary on an e-ink screen.

## Subsystems

- `worker/` · Cloudflare Worker + D1 backend (TypeScript)
- `collector/` · Per-device log collector (Python, not yet implemented)
- `firmware/` · ESP32-S3 RLCD firmware (Arduino + LVGL, not yet implemented)

## Spec

See `docs/superpowers/specs/2026-04-11-tokei-design.md`.

## Manual Deploy Steps

The following steps require interactive Cloudflare authentication and must be run manually:

1. **Login to Cloudflare:**
   ```bash
   cd worker && npx wrangler login
   ```

2. **Create the D1 database:**
   ```bash
   cd worker && pnpm wrangler d1 create tokei
   ```
   Copy the `database_id` UUID from the output.

3. **Update `worker/wrangler.toml`:** Replace `PLACEHOLDER_WILL_BE_SET_AT_DEPLOY` with the real database UUID.

4. **Apply migrations locally (dry run):**
   ```bash
   cd worker && pnpm db:migrate:local
   ```

5. **Set the bearer token secret:**
   ```bash
   cd worker && pnpm wrangler secret put TOKEI_BEARER_TOKEN
   # Enter a long random string when prompted
   ```

6. **Deploy the worker:**
   ```bash
   cd worker && pnpm deploy
   ```

7. **Apply migrations to remote D1:**
   ```bash
   cd worker && pnpm db:migrate:prod
   ```

8. **Smoke test with curl:**
   ```bash
   TOKEI_URL=https://tokei-worker.<your-subdomain>.workers.dev
   TOKEN=<bearer token you set>

   # Should 401 without token
   curl -i -X GET "$TOKEI_URL/v1/summary"

   # Should 200 with token
   curl -i -H "Authorization: Bearer $TOKEN" "$TOKEI_URL/v1/summary"

   # Ingest a test event
   curl -i -X POST "$TOKEI_URL/v1/ingest" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"device_id":"smoke","events":[{"tool":"claude_code","event_uuid":"smoke-1","ts":'$(date +%s)',"model":"claude-sonnet-4-5","input_tokens":1000,"output_tokens":500,"cached_input_tokens":0,"cache_creation_tokens":0,"reasoning_output_tokens":0}]}'
   ```

9. **Trigger cron manually to populate prices:**
   ```bash
   cd worker && pnpm wrangler cron trigger tokei-worker
   ```

10. **Commit the real database_id:**
    ```bash
    git add worker/wrangler.toml && git commit -m "chore(worker): wire deployed d1 database id"
    ```
