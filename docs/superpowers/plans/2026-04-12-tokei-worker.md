# Tokei Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare Worker that ingests AI token usage events from devices and serves aggregated daily/monthly summaries to an e-ink display.

**Architecture:** Stateless TypeScript worker on Cloudflare Workers runtime, backed by D1 (SQLite). Two oRPC routes (`POST /v1/ingest`, `GET /v1/summary`) plus a daily cron trigger that syncs model prices from LiteLLM. Contract-first API with shared zod schemas. Price fallback to `claude-opus-4-6` for unknown models.

**Tech Stack:** TypeScript strict · pnpm · oxlint · Drizzle ORM · Cloudflare D1 · `@orpc/contract` · `@orpc/server` · zod · vitest + `@cloudflare/vitest-pool-workers` · wrangler

**Spec Reference:** `docs/superpowers/specs/2026-04-11-tokei-design.md`

**Scope:** This plan covers only the Worker subsystem. Collector and Firmware are separate plans written after this one is complete.

---

## File Structure

### Monorepo root (created in Task 1, shared with future plans)

| Path | Responsibility |
|---|---|
| `.gitignore` | Ignore `node_modules/`, `.wrangler/`, `dist/`, secrets, `.env*` |
| `README.md` | Monorepo overview |
| `pnpm-workspace.yaml` | Workspace package declaration |
| `package.json` | Monorepo root; lint/format/test scripts |
| `fixtures/events/*.json` | Shared event fixtures consumed by Worker + future Collector tests |
| `fixtures/summaries/*.json` | Shared summary fixtures |

### Worker package

| Path | Responsibility |
|---|---|
| `worker/package.json` | Worker dependencies + scripts |
| `worker/tsconfig.json` | TypeScript strict mode config |
| `worker/wrangler.toml` | Cloudflare Workers binding (D1, vars, cron) |
| `worker/drizzle.config.ts` | drizzle-kit migration config |
| `worker/vitest.config.ts` | vitest + `@cloudflare/vitest-pool-workers` |
| `worker/src/env.ts` | `Env` type alias for bindings |
| `worker/src/index.ts` | Main Worker entry (`fetch` + `scheduled`) |
| `worker/src/router.ts` | Router composition with middleware |
| `worker/src/contract/index.ts` | `tokeiContract` + zod schemas + `os` handler builder |
| `worker/src/middleware/auth.ts` | Bearer token check |
| `worker/src/middleware/errorHandler.ts` | Translate thrown errors to oRPC errors + logging |
| `worker/src/db/schema.ts` | Drizzle `events` / `prices` / `quotes` tables |
| `worker/src/db/events.ts` | `insertBatch` (INSERT OR IGNORE) + dedup count |
| `worker/src/db/prices.ts` | `getPriceWithFallback` + `computeUsdCost` |
| `worker/src/db/aggregate.ts` | `today` / `month` / `sparkline7d` queries |
| `worker/src/db/quotes.ts` | `getDailyQuote` rotation |
| `worker/src/routes/ingest.ts` | POST /v1/ingest handler |
| `worker/src/routes/summary.ts` | GET /v1/summary handler |
| `worker/src/cron/fetchPrices.ts` | Scheduled handler for LiteLLM price sync |
| `worker/migrations/0001_init.sql` | Events + prices + quotes tables DDL |
| `worker/migrations/0002_seed_quotes.sql` | Minimal 8-quote seed (2 per category) |
| `worker/test/setup.ts` | vitest global setup: apply migrations to D1 |
| `worker/test/db/events.test.ts` | Events helper tests |
| `worker/test/db/prices.test.ts` | Prices helper tests |
| `worker/test/db/aggregate.test.ts` | Aggregate query tests |
| `worker/test/db/quotes.test.ts` | Quote rotation tests |
| `worker/test/routes/ingest.test.ts` | /ingest route tests |
| `worker/test/routes/summary.test.ts` | /summary route tests |
| `worker/test/cron/fetchPrices.test.ts` | Cron handler test |
| `worker/test/contract.test.ts` | Shared fixtures contract test |

---

## Task 1: Monorepo scaffold and git init

**Files:**
- Create: `/Users/chichi/workspace/xx/tokei/.gitignore`
- Create: `/Users/chichi/workspace/xx/tokei/README.md`
- Create: `/Users/chichi/workspace/xx/tokei/pnpm-workspace.yaml`
- Create: `/Users/chichi/workspace/xx/tokei/package.json`

- [ ] **Step 1: Initialize git repository**

```bash
cd /Users/chichi/workspace/xx/tokei
git init
git branch -m main
```

Expected: `Initialized empty Git repository in .../tokei/.git/`

- [ ] **Step 2: Write .gitignore**

```
# deps
node_modules/
.pnpm-store/

# build
dist/
build/
*.tsbuildinfo

# cloudflare
.wrangler/
.dev.vars
.env*
!.env.example

# python (for future collector)
.venv/
__pycache__/
*.pyc

# firmware (for future)
.pio/
.vscode/

# editor
.idea/
.DS_Store

# test output
coverage/

# local tokei state
.superpowers/
```

- [ ] **Step 3: Write pnpm-workspace.yaml**

```yaml
packages:
  - worker
```

(Collector is Python/uv, not a pnpm package. Firmware is PlatformIO, not a pnpm package. Only `worker` is in the pnpm workspace.)

- [ ] **Step 4: Write monorepo root package.json**

```json
{
  "name": "tokei",
  "version": "0.0.1",
  "private": true,
  "description": "AI token usage ambient display",
  "scripts": {
    "lint": "pnpm --filter worker lint",
    "test": "pnpm --filter worker test",
    "build": "pnpm --filter worker build",
    "deploy:worker": "pnpm --filter worker deploy"
  },
  "packageManager": "pnpm@9.12.0"
}
```

- [ ] **Step 5: Write README.md**

```markdown
# Tokei

AI token usage ambient display. Reads token usage from local AI tool logs, uploads to a Cloudflare Worker, renders a summary on an e-ink screen.

## Subsystems

- `worker/` · Cloudflare Worker + D1 backend (TypeScript)
- `collector/` · Per-device log collector (Python, not yet implemented)
- `firmware/` · ESP32-S3 RLCD firmware (Arduino + LVGL, not yet implemented)

## Spec

See `docs/superpowers/specs/2026-04-11-tokei-design.md`.
```

- [ ] **Step 6: Stage and commit monorepo skeleton**

```bash
cd /Users/chichi/workspace/xx/tokei
git add .gitignore README.md pnpm-workspace.yaml package.json docs/
git commit -m "chore: scaffold tokei monorepo with spec"
```

Expected: `[main (root-commit) ...] chore: scaffold tokei monorepo with spec`

---

## Task 2: Worker package scaffold

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml`
- Create: `worker/drizzle.config.ts`
- Create: `worker/.dev.vars.example`
- Create: `worker/src/env.ts`

- [ ] **Step 1: Create worker/package.json**

```json
{
  "name": "@tokei/worker",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "build": "tsc --noEmit",
    "lint": "oxlint src test",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply tokei --local",
    "db:migrate:prod": "wrangler d1 migrations apply tokei --remote"
  },
  "dependencies": {
    "@orpc/contract": "^0.54.0",
    "@orpc/server": "^0.54.0",
    "drizzle-orm": "^0.36.4",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.40",
    "@cloudflare/workers-types": "^4.20241106.0",
    "drizzle-kit": "^0.29.1",
    "oxlint": "^0.13.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5",
    "wrangler": "^3.86.1"
  }
}
```

- [ ] **Step 2: Create worker/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "drizzle.config.ts", "vitest.config.ts"],
  "exclude": ["node_modules", "dist", ".wrangler"]
}
```

- [ ] **Step 3: Create worker/wrangler.toml**

```toml
name = "tokei-worker"
main = "src/index.ts"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "tokei"
database_id = "PLACEHOLDER_WILL_BE_SET_AT_DEPLOY"
migrations_dir = "migrations"

[triggers]
crons = ["0 3 * * *"]  # daily 03:00 UTC price fetch

[vars]
# TOKEI_BEARER_TOKEN is set via `wrangler secret put TOKEI_BEARER_TOKEN`
# LITELLM_PRICE_URL defaults below but can be overridden
LITELLM_PRICE_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
TOKEI_TIMEZONE = "Asia/Shanghai"
```

- [ ] **Step 4: Create worker/drizzle.config.ts**

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
})
```

- [ ] **Step 5: Create worker/.dev.vars.example**

```
TOKEI_BEARER_TOKEN=dev-token-change-me
```

- [ ] **Step 6: Create worker/src/env.ts**

```ts
export type Env = {
  DB: D1Database
  TOKEI_BEARER_TOKEN: string
  LITELLM_PRICE_URL: string
  TOKEI_TIMEZONE: string
}
```

- [ ] **Step 7: Commit**

```bash
git add worker/
git commit -m "chore(worker): scaffold package config"
```

---

## Task 3: Install dependencies

**Files:**
- Generate: `worker/pnpm-lock.yaml`
- Generate: `worker/node_modules/`

- [ ] **Step 1: Install deps**

```bash
cd /Users/chichi/workspace/xx/tokei
pnpm install
```

Expected: `Progress: resolved X, reused Y, downloaded Z. Done`

- [ ] **Step 2: Verify type check passes on empty project**

```bash
pnpm --filter @tokei/worker run build
```

Expected: no errors (no .ts files yet besides env.ts, which has no issues)

- [ ] **Step 3: Commit lockfile**

```bash
git add worker/pnpm-lock.yaml
git commit -m "chore(worker): install dependencies"
```

---

## Task 4: Vitest + pool-workers configuration

**Files:**
- Create: `worker/vitest.config.ts`
- Create: `worker/test/setup.ts`

- [ ] **Step 1: Create vitest.config.ts**

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['DB'],
          bindings: {
            TOKEI_BEARER_TOKEN: 'test-token',
            LITELLM_PRICE_URL: 'https://fake.local/prices.json',
            TOKEI_TIMEZONE: 'Asia/Shanghai',
          },
        },
      },
    },
    setupFiles: ['./test/setup.ts'],
  },
})
```

- [ ] **Step 2: Create test/setup.ts (placeholder, populated in Task 6)**

```ts
// Global test setup: applies migrations to the ephemeral D1 database.
// Populated in Task 6 once the migrations directory exists.
import { beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

beforeEach(async () => {
  // placeholder · real migration apply happens in Task 6
  void env
})
```

- [ ] **Step 3: Run empty vitest to verify config**

```bash
cd worker && pnpm test
```

Expected: `No test files found` (not an error, config is valid)

- [ ] **Step 4: Commit**

```bash
git add worker/vitest.config.ts worker/test/setup.ts
git commit -m "chore(worker): configure vitest with cloudflare pool"
```

---

## Task 5: D1 schema · events / prices / quotes

**Files:**
- Create: `worker/src/db/schema.ts`
- Create: `worker/migrations/0001_init.sql`

- [ ] **Step 1: Write Drizzle schema**

`worker/src/db/schema.ts`:

```ts
import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core'

export const events = sqliteTable(
  'events',
  {
    deviceId: text('device_id').notNull(),
    tool: text('tool', { enum: ['claude_code', 'codex', 'cursor', 'gemini'] }).notNull(),
    eventUuid: text('event_uuid').notNull(),
    ts: integer('ts').notNull(),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    reasoningOutputTokens: integer('reasoning_output_tokens').notNull().default(0),
    usdCost: real('usd_cost'),
    usedFallbackPrice: integer('used_fallback_price', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.deviceId, t.tool, t.eventUuid] }),
    tsToolIdx: index('idx_events_ts_tool').on(t.ts, t.tool),
  }),
)

export const prices = sqliteTable('prices', {
  model: text('model').primaryKey(),
  inputCostPerToken: real('input_cost_per_token').notNull(),
  outputCostPerToken: real('output_cost_per_token').notNull(),
  cacheReadInputTokenCost: real('cache_read_input_token_cost'),
  cacheCreationInputTokenCost: real('cache_creation_input_token_cost'),
  updatedAt: integer('updated_at').notNull(),
})

export const quotes = sqliteTable('quotes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  text: text('text').notNull(),
  attr: text('attr'),
  category: text('category', {
    enum: ['computing', 'poetry-tang', 'scifi', 'philosophy'],
  }).notNull(),
  lang: text('lang', { enum: ['en', 'zh'] }).notNull().default('en'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
})
```

- [ ] **Step 2: Generate migration with drizzle-kit**

```bash
cd worker && pnpm db:generate
```

Expected: creates `migrations/0000_xxxxx.sql` (name auto-generated by drizzle-kit).

- [ ] **Step 3: Rename the generated migration for clarity**

```bash
cd worker/migrations && mv 0000_*.sql 0001_init.sql
```

- [ ] **Step 4: Verify migration SQL content**

Read `worker/migrations/0001_init.sql` and confirm it contains `CREATE TABLE events`, `CREATE TABLE prices`, `CREATE TABLE quotes`, and the `idx_events_ts_tool` index. If drizzle-kit's output differs, manually adjust the file to match this expected schema:

```sql
CREATE TABLE `events` (
    `device_id` text NOT NULL,
    `tool` text NOT NULL,
    `event_uuid` text NOT NULL,
    `ts` integer NOT NULL,
    `model` text,
    `input_tokens` integer DEFAULT 0 NOT NULL,
    `cached_input_tokens` integer DEFAULT 0 NOT NULL,
    `output_tokens` integer DEFAULT 0 NOT NULL,
    `cache_creation_tokens` integer DEFAULT 0 NOT NULL,
    `reasoning_output_tokens` integer DEFAULT 0 NOT NULL,
    `usd_cost` real,
    `used_fallback_price` integer DEFAULT 0 NOT NULL,
    PRIMARY KEY(`device_id`, `tool`, `event_uuid`)
);
CREATE INDEX `idx_events_ts_tool` ON `events` (`ts`, `tool`);

CREATE TABLE `prices` (
    `model` text PRIMARY KEY NOT NULL,
    `input_cost_per_token` real NOT NULL,
    `output_cost_per_token` real NOT NULL,
    `cache_read_input_token_cost` real,
    `cache_creation_input_token_cost` real,
    `updated_at` integer NOT NULL
);

CREATE TABLE `quotes` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `text` text NOT NULL,
    `attr` text,
    `category` text NOT NULL,
    `lang` text DEFAULT 'en' NOT NULL,
    `enabled` integer DEFAULT 1 NOT NULL
);
```

- [ ] **Step 5: Update test/setup.ts to apply migration before each test**

```ts
import { beforeEach } from 'vitest'
import { env, applyD1Migrations } from 'cloudflare:test'
import migrations from '../migrations/0001_init.sql?raw'
import seedQuotes from '../migrations/0002_seed_quotes.sql?raw'

beforeEach(async () => {
  await env.DB.exec(migrations)
  await env.DB.exec(seedQuotes)
})
```

Note: `0002_seed_quotes.sql` is created in Task 6. This `setup.ts` will fail type-check until that task is done; that's OK within this plan because Task 6 is the next step.

- [ ] **Step 6: Commit**

```bash
git add worker/src/db/schema.ts worker/migrations/0001_init.sql worker/test/setup.ts
git commit -m "feat(worker): d1 schema with drizzle"
```

---

## Task 6: Seed quotes migration

**Files:**
- Create: `worker/migrations/0002_seed_quotes.sql`

The full 80-quote seed (4 categories × 20) is deferred to a later data task. For MVP we seed 8 quotes (2 per category) so the rotation and category queries can be tested.

- [ ] **Step 1: Write seed migration**

```sql
-- worker/migrations/0002_seed_quotes.sql
INSERT INTO quotes (text, attr, category, lang) VALUES
    ('Premature optimization is the root of all evil.', 'Donald Knuth', 'computing', 'en'),
    ('Simplicity is prerequisite for reliability.', 'Edsger Dijkstra', 'computing', 'en'),
    ('行到水穷处，坐看云起时。', '王维《终南别业》', 'poetry-tang', 'zh'),
    ('欲穷千里目，更上一层楼。', '王之涣《登鹳雀楼》', 'poetry-tang', 'zh'),
    ('弱小和无知不是生存的障碍，傲慢才是。', '刘慈欣《三体》', 'scifi', 'zh'),
    ('The future is already here. It is just not evenly distributed.', 'William Gibson', 'scifi', 'en'),
    ('The limits of my language mean the limits of my world.', 'Wittgenstein', 'philosophy', 'en'),
    ('人是被抛入这个世界的。', 'Heidegger', 'philosophy', 'zh');
```

- [ ] **Step 2: Verify vitest setup loads both migrations successfully**

```bash
cd worker && pnpm test
```

Expected: `No test files found` (still no tests, but imports succeed).

- [ ] **Step 3: Commit**

```bash
git add worker/migrations/0002_seed_quotes.sql
git commit -m "feat(worker): seed initial 8 quotes across 4 categories"
```

---

## Task 7: oRPC contract · schemas and router

**Files:**
- Create: `worker/src/contract/index.ts`

- [ ] **Step 1: Write the contract**

`worker/src/contract/index.ts`:

```ts
import { oc } from '@orpc/contract'
import { implement } from '@orpc/server'
import { z } from 'zod'
import type { Env } from '../env'

export const TOOLS = ['claude_code', 'codex', 'cursor', 'gemini'] as const
export const QUOTE_CATEGORIES = ['computing', 'poetry-tang', 'scifi', 'philosophy'] as const

const toolEnum = z.enum(TOOLS)

export const eventSchema = z.object({
  tool: toolEnum,
  event_uuid: z.string().min(1).max(128),
  ts: z.number().int(),
  model: z.string().nullable(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cached_input_tokens: z.number().int().nonnegative().default(0),
  cache_creation_tokens: z.number().int().nonnegative().default(0),
  reasoning_output_tokens: z.number().int().nonnegative().default(0),
})
export type EventInput = z.infer<typeof eventSchema>

export const summaryResponseSchema = z.object({
  today: z.object({
    total_tokens: z.number().int(),
    total_usd: z.number(),
    tools: z.array(
      z.object({
        name: toolEnum,
        tokens: z.number().int(),
        usd: z.number(),
      }),
    ),
  }),
  month: z.object({
    total_tokens: z.number().int(),
    total_usd: z.number(),
  }),
  sparkline_7d: z.array(z.number().int()).length(7),
  quote: z.object({
    text: z.string(),
    attr: z.string(),
    category: z.enum(QUOTE_CATEGORIES),
    lang: z.enum(['en', 'zh']),
  }),
  sync_ts: z.number().int(),
  fallback_priced_tokens: z.number().int().nonnegative().default(0),
})
export type SummaryResponse = z.infer<typeof summaryResponseSchema>

export const tokeiContract = oc
  .prefix('/v1')
  .tag('Tokei')
  .router({
    ingest: oc
      .route({ method: 'POST', path: '/ingest' })
      .input(
        z.object({
          device_id: z.string().min(1).max(64),
          events: z.array(eventSchema).min(1).max(500),
        }),
      )
      .output(
        z.object({
          accepted: z.number().int().nonnegative(),
          deduped: z.number().int().nonnegative(),
        }),
      )
      .errors({
        UNAUTHORIZED: { status: 401, message: 'Missing or invalid bearer token' },
        CLOCK_SKEW: { status: 422, message: 'Event timestamp skewed > 1 day from server time' },
      }),

    summary: oc
      .route({ method: 'GET', path: '/summary' })
      .output(summaryResponseSchema)
      .errors({
        UNAUTHORIZED: { status: 401, message: 'Missing or invalid bearer token' },
      }),
  })

export type HandlerContext = {
  env: Env
  db: D1Database
}

export const os = implement(tokeiContract).$context<HandlerContext>()
```

- [ ] **Step 2: Type-check**

```bash
cd worker && pnpm build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/contract/index.ts
git commit -m "feat(worker): orpc contract with ingest+summary schemas"
```

---

## Task 8: DB helper · events.insertBatch (TDD)

**Files:**
- Create: `worker/test/db/events.test.ts`
- Create: `worker/src/db/events.ts`

- [ ] **Step 1: Write the failing test**

`worker/test/db/events.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { events } from '../../src/db/schema'
import { insertEvents } from '../../src/db/events'
import type { EventInput } from '../../src/contract'

const db = () => drizzle(env.DB)

const sample = (overrides: Partial<EventInput> = {}): EventInput => ({
  tool: 'claude_code',
  event_uuid: 'uuid-1',
  ts: 1744370000,
  model: 'claude-sonnet-4-5',
  input_tokens: 100,
  output_tokens: 50,
  cached_input_tokens: 0,
  cache_creation_tokens: 0,
  reasoning_output_tokens: 0,
  ...overrides,
})

describe('insertEvents', () => {
  it('inserts new events and returns accepted count', async () => {
    const result = await insertEvents(db(), 'dev-1', [sample(), sample({ event_uuid: 'uuid-2' })])
    expect(result.accepted).toBe(2)
    expect(result.deduped).toBe(0)

    const rows = await db().select().from(events).all()
    expect(rows).toHaveLength(2)
  })

  it('dedups on (device_id, tool, event_uuid)', async () => {
    await insertEvents(db(), 'dev-1', [sample()])
    const result = await insertEvents(db(), 'dev-1', [sample(), sample({ event_uuid: 'uuid-2' })])
    expect(result.accepted).toBe(1)
    expect(result.deduped).toBe(1)
  })

  it('allows same event_uuid from different devices', async () => {
    await insertEvents(db(), 'dev-1', [sample()])
    const result = await insertEvents(db(), 'dev-2', [sample()])
    expect(result.accepted).toBe(1)
    expect(result.deduped).toBe(0)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd worker && pnpm vitest run test/db/events.test.ts
```

Expected: FAIL · `Cannot find module '../../src/db/events'`.

- [ ] **Step 3: Implement insertEvents**

`worker/src/db/events.ts`:

```ts
import { drizzle } from 'drizzle-orm/d1'
import { sql } from 'drizzle-orm'
import { events } from './schema'
import type { EventInput } from '../contract'

export type InsertResult = { accepted: number; deduped: number }
export type Db = ReturnType<typeof drizzle>

export async function insertEvents(db: Db, deviceId: string, batch: EventInput[]): Promise<InsertResult> {
  if (batch.length === 0) return { accepted: 0, deduped: 0 }

  // Count existing rows for these keys BEFORE insert so we can compute dedup count.
  const before = await countExisting(db, deviceId, batch)

  const rows = batch.map((e) => ({
    deviceId,
    tool: e.tool,
    eventUuid: e.event_uuid,
    ts: e.ts,
    model: e.model,
    inputTokens: e.input_tokens,
    cachedInputTokens: e.cached_input_tokens,
    outputTokens: e.output_tokens,
    cacheCreationTokens: e.cache_creation_tokens,
    reasoningOutputTokens: e.reasoning_output_tokens,
    usdCost: null,
    usedFallbackPrice: false,
  }))

  await db.insert(events).values(rows).onConflictDoNothing().run()

  const accepted = batch.length - before
  return { accepted, deduped: before }
}

async function countExisting(db: Db, deviceId: string, batch: EventInput[]): Promise<number> {
  // Build (tool, event_uuid) tuples and count hits.
  const tuples = batch.map((e) => `('${escapeSql(e.tool)}', '${escapeSql(e.event_uuid)}')`).join(',')
  const query = sql.raw(
    `SELECT COUNT(*) as n FROM events WHERE device_id = '${escapeSql(deviceId)}' AND (tool, event_uuid) IN (${tuples})`,
  )
  const result = await db.all<{ n: number }>(query)
  return result[0]?.n ?? 0
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}
```

Note: we build raw SQL for the `IN` clause because Drizzle's parameterized `IN` does not support composite keys cleanly. Input is always string-escaped. For defense in depth, the route layer also validates `event_uuid` length and character set via zod.

- [ ] **Step 4: Run tests, expect pass**

```bash
cd worker && pnpm vitest run test/db/events.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/db/events.ts worker/test/db/events.test.ts
git commit -m "feat(worker): insertEvents with dedup count"
```

---

## Task 9: DB helper · prices.getPriceWithFallback

**Files:**
- Create: `worker/test/db/prices.test.ts`
- Create: `worker/src/db/prices.ts`

- [ ] **Step 1: Write the failing test**

`worker/test/db/prices.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { prices } from '../../src/db/schema'
import { getPriceWithFallback, computeUsdCost, FALLBACK_MODEL } from '../../src/db/prices'

const db = () => drizzle(env.DB)

beforeEach(async () => {
  await db()
    .insert(prices)
    .values([
      {
        model: 'claude-sonnet-4-5',
        inputCostPerToken: 3e-6,
        outputCostPerToken: 15e-6,
        cacheReadInputTokenCost: 0.3e-6,
        cacheCreationInputTokenCost: 3.75e-6,
        updatedAt: 1744000000,
      },
      {
        model: FALLBACK_MODEL,
        inputCostPerToken: 5e-6,
        outputCostPerToken: 25e-6,
        cacheReadInputTokenCost: 0.5e-6,
        cacheCreationInputTokenCost: 6.25e-6,
        updatedAt: 1744000000,
      },
    ])
    .run()
})

describe('getPriceWithFallback', () => {
  it('returns exact-match price when model exists', async () => {
    const price = await getPriceWithFallback(db(), 'claude-sonnet-4-5')
    expect(price.model).toBe('claude-sonnet-4-5')
    expect(price.usedFallback).toBe(false)
    expect(price.inputCostPerToken).toBe(3e-6)
  })

  it('returns Opus fallback when model is unknown', async () => {
    const price = await getPriceWithFallback(db(), 'gpt-999-future')
    expect(price.model).toBe(FALLBACK_MODEL)
    expect(price.usedFallback).toBe(true)
    expect(price.inputCostPerToken).toBe(5e-6)
  })

  it('returns Opus fallback when model is null', async () => {
    const price = await getPriceWithFallback(db(), null)
    expect(price.usedFallback).toBe(true)
  })
})

describe('computeUsdCost', () => {
  it('sums input + output cost', () => {
    const price = {
      model: 'claude-sonnet-4-5',
      inputCostPerToken: 3e-6,
      outputCostPerToken: 15e-6,
      cacheReadInputTokenCost: 0.3e-6,
      cacheCreationInputTokenCost: 3.75e-6,
      usedFallback: false,
    }
    const event = {
      input_tokens: 1000,
      output_tokens: 500,
      cached_input_tokens: 0,
      cache_creation_tokens: 0,
      reasoning_output_tokens: 0,
    }
    // 1000 * 3e-6 + 500 * 15e-6 = 0.003 + 0.0075 = 0.0105
    expect(computeUsdCost(price, event)).toBeCloseTo(0.0105, 6)
  })

  it('includes cache read + cache creation when price available', () => {
    const price = {
      model: 'claude-sonnet-4-5',
      inputCostPerToken: 3e-6,
      outputCostPerToken: 15e-6,
      cacheReadInputTokenCost: 0.3e-6,
      cacheCreationInputTokenCost: 3.75e-6,
      usedFallback: false,
    }
    const event = {
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 1000,
      cache_creation_tokens: 1000,
      reasoning_output_tokens: 0,
    }
    // 1000 * 0.3e-6 + 1000 * 3.75e-6 = 0.0003 + 0.00375 = 0.00405
    expect(computeUsdCost(price, event)).toBeCloseTo(0.00405, 6)
  })

  it('counts reasoning output at output rate', () => {
    const price = {
      model: 'claude-sonnet-4-5',
      inputCostPerToken: 3e-6,
      outputCostPerToken: 15e-6,
      cacheReadInputTokenCost: 0.3e-6,
      cacheCreationInputTokenCost: 3.75e-6,
      usedFallback: false,
    }
    const event = {
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_tokens: 0,
      reasoning_output_tokens: 1000,
    }
    // 1000 * 15e-6 = 0.015
    expect(computeUsdCost(price, event)).toBeCloseTo(0.015, 6)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd worker && pnpm vitest run test/db/prices.test.ts
```

Expected: FAIL · missing module.

- [ ] **Step 3: Implement prices helper**

`worker/src/db/prices.ts`:

```ts
import { eq } from 'drizzle-orm'
import { prices } from './schema'
import type { Db } from './events'

export const FALLBACK_MODEL = 'claude-opus-4-6'

export type PriceRow = {
  model: string
  inputCostPerToken: number
  outputCostPerToken: number
  cacheReadInputTokenCost: number | null
  cacheCreationInputTokenCost: number | null
  usedFallback: boolean
}

export async function getPriceWithFallback(db: Db, model: string | null): Promise<PriceRow> {
  if (model) {
    const row = await db.select().from(prices).where(eq(prices.model, model)).get()
    if (row) {
      return {
        model: row.model,
        inputCostPerToken: row.inputCostPerToken,
        outputCostPerToken: row.outputCostPerToken,
        cacheReadInputTokenCost: row.cacheReadInputTokenCost,
        cacheCreationInputTokenCost: row.cacheCreationInputTokenCost,
        usedFallback: false,
      }
    }
  }
  const fallback = await db.select().from(prices).where(eq(prices.model, FALLBACK_MODEL)).get()
  if (!fallback) {
    throw new Error(`Fallback price row missing: ${FALLBACK_MODEL}. Run price sync cron first.`)
  }
  return {
    model: fallback.model,
    inputCostPerToken: fallback.inputCostPerToken,
    outputCostPerToken: fallback.outputCostPerToken,
    cacheReadInputTokenCost: fallback.cacheReadInputTokenCost,
    cacheCreationInputTokenCost: fallback.cacheCreationInputTokenCost,
    usedFallback: true,
  }
}

export type CostableEvent = {
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  cache_creation_tokens: number
  reasoning_output_tokens: number
}

export function computeUsdCost(price: PriceRow, event: CostableEvent): number {
  const cacheRead = price.cacheReadInputTokenCost ?? price.inputCostPerToken
  const cacheCreate = price.cacheCreationInputTokenCost ?? price.inputCostPerToken
  return (
    event.input_tokens * price.inputCostPerToken +
    event.output_tokens * price.outputCostPerToken +
    event.cached_input_tokens * cacheRead +
    event.cache_creation_tokens * cacheCreate +
    event.reasoning_output_tokens * price.outputCostPerToken
  )
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd worker && pnpm vitest run test/db/prices.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/db/prices.ts worker/test/db/prices.test.ts
git commit -m "feat(worker): price lookup with opus-4-6 fallback + usd cost calc"
```

---

## Task 10: Extend insertEvents to set usd_cost on insert

**Files:**
- Modify: `worker/src/db/events.ts`
- Modify: `worker/test/db/events.test.ts`

- [ ] **Step 1: Add a failing test for usd_cost snapshot**

Append to `worker/test/db/events.test.ts`:

```ts
import { prices } from '../../src/db/schema'
import { FALLBACK_MODEL } from '../../src/db/prices'
import { beforeEach } from 'vitest'

beforeEach(async () => {
  await db()
    .insert(prices)
    .values([
      {
        model: 'claude-sonnet-4-5',
        inputCostPerToken: 3e-6,
        outputCostPerToken: 15e-6,
        cacheReadInputTokenCost: 0.3e-6,
        cacheCreationInputTokenCost: 3.75e-6,
        updatedAt: 1744000000,
      },
      {
        model: FALLBACK_MODEL,
        inputCostPerToken: 5e-6,
        outputCostPerToken: 25e-6,
        cacheReadInputTokenCost: 0.5e-6,
        cacheCreationInputTokenCost: 6.25e-6,
        updatedAt: 1744000000,
      },
    ])
    .run()
})

describe('insertEvents · usd_cost snapshot', () => {
  it('computes usd_cost using current price at insert time', async () => {
    await insertEvents(db(), 'dev-1', [sample({ input_tokens: 1000, output_tokens: 500 })])
    const row = await db().select().from(events).get()
    expect(row?.usdCost).toBeCloseTo(1000 * 3e-6 + 500 * 15e-6, 6)
    expect(row?.usedFallbackPrice).toBe(false)
  })

  it('marks usedFallbackPrice=true for unknown model', async () => {
    await insertEvents(db(), 'dev-1', [sample({ model: 'gpt-unknown', input_tokens: 1000, output_tokens: 0 })])
    const row = await db().select().from(events).get()
    expect(row?.usedFallbackPrice).toBe(true)
    // fallback Opus: 1000 * 5e-6 = 0.005
    expect(row?.usdCost).toBeCloseTo(0.005, 6)
  })
})
```

- [ ] **Step 2: Run tests, expect failure**

```bash
cd worker && pnpm vitest run test/db/events.test.ts
```

Expected: new tests FAIL (`usdCost` is null from Task 8 implementation).

- [ ] **Step 3: Update insertEvents to price rows before insert**

Replace the body of `insertEvents` in `worker/src/db/events.ts`:

```ts
import { drizzle } from 'drizzle-orm/d1'
import { sql } from 'drizzle-orm'
import { events } from './schema'
import { getPriceWithFallback, computeUsdCost } from './prices'
import type { EventInput } from '../contract'

export type InsertResult = { accepted: number; deduped: number }
export type Db = ReturnType<typeof drizzle>

export async function insertEvents(db: Db, deviceId: string, batch: EventInput[]): Promise<InsertResult> {
  if (batch.length === 0) return { accepted: 0, deduped: 0 }

  const before = await countExisting(db, deviceId, batch)

  // Price each row at insert time. Prices are cached by model to avoid repeat lookups.
  const priceCache = new Map<string, Awaited<ReturnType<typeof getPriceWithFallback>>>()
  const rows = await Promise.all(
    batch.map(async (e) => {
      const key = e.model ?? '__null__'
      let price = priceCache.get(key)
      if (!price) {
        price = await getPriceWithFallback(db, e.model)
        priceCache.set(key, price)
      }
      return {
        deviceId,
        tool: e.tool,
        eventUuid: e.event_uuid,
        ts: e.ts,
        model: e.model,
        inputTokens: e.input_tokens,
        cachedInputTokens: e.cached_input_tokens,
        outputTokens: e.output_tokens,
        cacheCreationTokens: e.cache_creation_tokens,
        reasoningOutputTokens: e.reasoning_output_tokens,
        usdCost: computeUsdCost(price, e),
        usedFallbackPrice: price.usedFallback,
      }
    }),
  )

  await db.insert(events).values(rows).onConflictDoNothing().run()

  const accepted = batch.length - before
  return { accepted, deduped: before }
}

async function countExisting(db: Db, deviceId: string, batch: EventInput[]): Promise<number> {
  const tuples = batch.map((e) => `('${escapeSql(e.tool)}', '${escapeSql(e.event_uuid)}')`).join(',')
  const query = sql.raw(
    `SELECT COUNT(*) as n FROM events WHERE device_id = '${escapeSql(deviceId)}' AND (tool, event_uuid) IN (${tuples})`,
  )
  const result = await db.all<{ n: number }>(query)
  return result[0]?.n ?? 0
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd worker && pnpm vitest run test/db/events.test.ts
```

Expected: all events tests PASS (5 total now).

- [ ] **Step 5: Commit**

```bash
git add worker/src/db/events.ts worker/test/db/events.test.ts
git commit -m "feat(worker): compute usd_cost snapshot at insert"
```

---

## Task 11: DB helper · aggregate.today

**Files:**
- Create: `worker/test/db/aggregate.test.ts`
- Create: `worker/src/db/aggregate.ts`

- [ ] **Step 1: Write failing test**

`worker/test/db/aggregate.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { prices } from '../../src/db/schema'
import { insertEvents } from '../../src/db/events'
import { aggregateToday } from '../../src/db/aggregate'
import { FALLBACK_MODEL } from '../../src/db/prices'
import type { EventInput } from '../../src/contract'

const TZ = 'Asia/Shanghai'
const db = () => drizzle(env.DB)

beforeEach(async () => {
  await db()
    .insert(prices)
    .values([
      {
        model: 'claude-sonnet-4-5',
        inputCostPerToken: 3e-6,
        outputCostPerToken: 15e-6,
        cacheReadInputTokenCost: 0.3e-6,
        cacheCreationInputTokenCost: 3.75e-6,
        updatedAt: 1744000000,
      },
      {
        model: FALLBACK_MODEL,
        inputCostPerToken: 5e-6,
        outputCostPerToken: 25e-6,
        cacheReadInputTokenCost: null,
        cacheCreationInputTokenCost: null,
        updatedAt: 1744000000,
      },
    ])
    .run()
})

// 2026-04-12 12:00 UTC+8 = 1744430400 - 28800 = 1744401600
const TODAY_NOON = 1744430400
const YESTERDAY_NOON = TODAY_NOON - 86400

const sample = (overrides: Partial<EventInput> = {}): EventInput => ({
  tool: 'claude_code',
  event_uuid: `uuid-${Math.random()}`,
  ts: TODAY_NOON,
  model: 'claude-sonnet-4-5',
  input_tokens: 1000,
  output_tokens: 500,
  cached_input_tokens: 0,
  cache_creation_tokens: 0,
  reasoning_output_tokens: 0,
  ...overrides,
})

describe('aggregateToday', () => {
  it('sums today tokens grouped by tool', async () => {
    await insertEvents(db(), 'dev-1', [
      sample({ tool: 'claude_code', input_tokens: 1000, output_tokens: 500 }),
      sample({ tool: 'claude_code', input_tokens: 2000, output_tokens: 1000 }),
      sample({ tool: 'cursor', input_tokens: 500, output_tokens: 200 }),
    ])

    const result = await aggregateToday(db(), TODAY_NOON, TZ)

    expect(result.total_tokens).toBe(1000 + 500 + 2000 + 1000 + 500 + 200)
    expect(result.tools).toHaveLength(2)
    const cc = result.tools.find((t) => t.name === 'claude_code')
    expect(cc?.tokens).toBe(1000 + 500 + 2000 + 1000)
    const cur = result.tools.find((t) => t.name === 'cursor')
    expect(cur?.tokens).toBe(500 + 200)
  })

  it('excludes events outside today window', async () => {
    await insertEvents(db(), 'dev-1', [
      sample({ tool: 'claude_code', event_uuid: 'today-1', ts: TODAY_NOON }),
      sample({ tool: 'claude_code', event_uuid: 'yesterday-1', ts: YESTERDAY_NOON }),
    ])

    const result = await aggregateToday(db(), TODAY_NOON, TZ)
    expect(result.total_tokens).toBe(1000 + 500)
    expect(result.tools).toHaveLength(1)
  })

  it('sums usd_cost across tools', async () => {
    await insertEvents(db(), 'dev-1', [sample({ input_tokens: 1000, output_tokens: 500 })])
    const result = await aggregateToday(db(), TODAY_NOON, TZ)
    expect(result.total_usd).toBeCloseTo(1000 * 3e-6 + 500 * 15e-6, 6)
  })

  it('sorts tools by tokens descending', async () => {
    await insertEvents(db(), 'dev-1', [
      sample({ tool: 'cursor', input_tokens: 5000, output_tokens: 0 }),
      sample({ tool: 'claude_code', input_tokens: 100, output_tokens: 0 }),
    ])
    const result = await aggregateToday(db(), TODAY_NOON, TZ)
    expect(result.tools[0]?.name).toBe('cursor')
    expect(result.tools[1]?.name).toBe('claude_code')
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd worker && pnpm vitest run test/db/aggregate.test.ts
```

Expected: FAIL · missing module.

- [ ] **Step 3: Implement aggregateToday**

`worker/src/db/aggregate.ts`:

```ts
import { sql } from 'drizzle-orm'
import type { Db } from './events'

export type TodayResult = {
  total_tokens: number
  total_usd: number
  tools: { name: 'claude_code' | 'codex' | 'cursor' | 'gemini'; tokens: number; usd: number }[]
}

/** Returns start-of-day unix seconds for the timezone, given a "now" timestamp. */
export function startOfDay(now: number, tz: string): number {
  // For MVP we only handle Asia/Shanghai (UTC+8). Extend via Intl APIs if needed.
  if (tz !== 'Asia/Shanghai') {
    throw new Error(`Unsupported timezone: ${tz}. MVP only handles Asia/Shanghai.`)
  }
  const offsetSec = 8 * 3600
  const local = now + offsetSec
  const localDayStart = local - (local % 86400)
  return localDayStart - offsetSec
}

type ToolRow = {
  tool: 'claude_code' | 'codex' | 'cursor' | 'gemini'
  tokens: number
  usd: number
}

export async function aggregateToday(db: Db, now: number, tz: string): Promise<TodayResult> {
  const todayStart = startOfDay(now, tz)

  const rows = await db.all<ToolRow>(
    sql`
      SELECT
        tool,
        CAST(COALESCE(SUM(input_tokens + output_tokens + cached_input_tokens + cache_creation_tokens + reasoning_output_tokens), 0) AS INTEGER) AS tokens,
        COALESCE(SUM(usd_cost), 0) AS usd
      FROM events
      WHERE ts >= ${todayStart}
      GROUP BY tool
      ORDER BY tokens DESC
    `,
  )

  const tools = rows.map((r) => ({ name: r.tool, tokens: r.tokens, usd: r.usd }))
  const total_tokens = tools.reduce((acc, t) => acc + t.tokens, 0)
  const total_usd = tools.reduce((acc, t) => acc + t.usd, 0)
  return { total_tokens, total_usd, tools }
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd worker && pnpm vitest run test/db/aggregate.test.ts
```

Expected: all aggregate tests PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/db/aggregate.ts worker/test/db/aggregate.test.ts
git commit -m "feat(worker): aggregateToday with tool breakdown"
```

---

## Task 12: DB helper · aggregate.month

**Files:**
- Modify: `worker/test/db/aggregate.test.ts`
- Modify: `worker/src/db/aggregate.ts`

- [ ] **Step 1: Add failing test**

Append to `worker/test/db/aggregate.test.ts`:

```ts
import { aggregateMonth } from '../../src/db/aggregate'

// first of April 2026 UTC+8 = 2026-04-01 00:00 CST = 1743436800
const APR_1 = 1743436800
const APR_12 = APR_1 + 11 * 86400
const MAR_31 = APR_1 - 3600

describe('aggregateMonth', () => {
  it('sums tokens from month start to now', async () => {
    await insertEvents(db(), 'dev-1', [
      sample({ tool: 'claude_code', event_uuid: 'apr-1', ts: APR_1, input_tokens: 1000, output_tokens: 0 }),
      sample({ tool: 'claude_code', event_uuid: 'apr-12', ts: APR_12, input_tokens: 2000, output_tokens: 0 }),
      sample({ tool: 'claude_code', event_uuid: 'mar-31', ts: MAR_31, input_tokens: 99999, output_tokens: 0 }),
    ])
    const result = await aggregateMonth(db(), APR_12, TZ)
    expect(result.total_tokens).toBe(1000 + 2000)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd worker && pnpm vitest run test/db/aggregate.test.ts
```

Expected: new test FAILs (`aggregateMonth` undefined).

- [ ] **Step 3: Implement aggregateMonth**

Append to `worker/src/db/aggregate.ts`:

```ts
export type MonthResult = { total_tokens: number; total_usd: number }

/** Returns start-of-month unix seconds for the timezone. */
export function startOfMonth(now: number, tz: string): number {
  if (tz !== 'Asia/Shanghai') {
    throw new Error(`Unsupported timezone: ${tz}. MVP only handles Asia/Shanghai.`)
  }
  const offsetSec = 8 * 3600
  const localMs = (now + offsetSec) * 1000
  const d = new Date(localMs)
  const firstUtcMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  return firstUtcMs / 1000 - offsetSec
}

export async function aggregateMonth(db: Db, now: number, tz: string): Promise<MonthResult> {
  const monthStart = startOfMonth(now, tz)
  const row = await db.get<{ tokens: number; usd: number }>(
    sql`
      SELECT
        CAST(COALESCE(SUM(input_tokens + output_tokens + cached_input_tokens + cache_creation_tokens + reasoning_output_tokens), 0) AS INTEGER) AS tokens,
        COALESCE(SUM(usd_cost), 0) AS usd
      FROM events
      WHERE ts >= ${monthStart}
    `,
  )
  return { total_tokens: row?.tokens ?? 0, total_usd: row?.usd ?? 0 }
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd worker && pnpm vitest run test/db/aggregate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/db/aggregate.ts worker/test/db/aggregate.test.ts
git commit -m "feat(worker): aggregateMonth helper"
```

---

## Task 13: DB helper · aggregate.sparkline7d

**Files:**
- Modify: `worker/test/db/aggregate.test.ts`
- Modify: `worker/src/db/aggregate.ts`

- [ ] **Step 1: Add failing test**

Append to `worker/test/db/aggregate.test.ts`:

```ts
import { sparkline7d } from '../../src/db/aggregate'

describe('sparkline7d', () => {
  it('returns 7 integer values (k tokens) oldest to newest', async () => {
    // Insert 1 event per day for 7 days, with increasing token counts
    for (let i = 0; i < 7; i++) {
      await insertEvents(db(), 'dev-1', [
        sample({
          event_uuid: `day-${i}`,
          ts: TODAY_NOON - i * 86400,
          input_tokens: (7 - i) * 1000, // newer day = more tokens
          output_tokens: 0,
        }),
      ])
    }

    const result = await sparkline7d(db(), TODAY_NOON, TZ)
    expect(result).toHaveLength(7)
    // Oldest first: day-6 (1k), day-5 (2k), ..., day-0 (7k)
    expect(result).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('fills missing days with 0', async () => {
    await insertEvents(db(), 'dev-1', [
      sample({ event_uuid: 'today', ts: TODAY_NOON, input_tokens: 5000, output_tokens: 0 }),
      sample({ event_uuid: 'four-days-ago', ts: TODAY_NOON - 4 * 86400, input_tokens: 3000, output_tokens: 0 }),
    ])

    const result = await sparkline7d(db(), TODAY_NOON, TZ)
    // Indices: 0=6 days ago, 6=today
    expect(result[6]).toBe(5)
    expect(result[2]).toBe(3)
    expect(result[0]).toBe(0)
    expect(result[1]).toBe(0)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd worker && pnpm vitest run test/db/aggregate.test.ts
```

Expected: FAIL · `sparkline7d` undefined.

- [ ] **Step 3: Implement sparkline7d**

Append to `worker/src/db/aggregate.ts`:

```ts
/** Returns 7 k-token values, oldest first. Missing days are filled with 0. */
export async function sparkline7d(db: Db, now: number, tz: string): Promise<number[]> {
  const todayStart = startOfDay(now, tz)
  const sixDaysAgoStart = todayStart - 6 * 86400

  const rows = await db.all<{ day_start: number; tokens: number }>(
    sql`
      SELECT
        CAST((ts - ((ts + 28800) % 86400)) AS INTEGER) AS day_start,
        CAST(COALESCE(SUM(input_tokens + output_tokens + cached_input_tokens + cache_creation_tokens + reasoning_output_tokens), 0) AS INTEGER) AS tokens
      FROM events
      WHERE ts >= ${sixDaysAgoStart}
      GROUP BY day_start
    `,
  )

  const byDay = new Map<number, number>()
  for (const r of rows) byDay.set(r.day_start, r.tokens)

  const result: number[] = []
  for (let i = 6; i >= 0; i--) {
    const dayStart = todayStart - i * 86400
    const tokens = byDay.get(dayStart) ?? 0
    result.push(Math.round(tokens / 1000))
  }
  return result
}
```

Note: the `(ts + 28800) % 86400` computes local-day bucket for Asia/Shanghai inline. When timezone becomes dynamic post-MVP, replace with a proper Intl-based bucketing helper.

- [ ] **Step 4: Run tests, expect pass**

```bash
cd worker && pnpm vitest run test/db/aggregate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/db/aggregate.ts worker/test/db/aggregate.test.ts
git commit -m "feat(worker): 7-day sparkline aggregator"
```

---

## Task 14: DB helper · quotes.getDailyQuote

**Files:**
- Create: `worker/test/db/quotes.test.ts`
- Create: `worker/src/db/quotes.ts`

- [ ] **Step 1: Write failing test**

`worker/test/db/quotes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { getDailyQuote } from '../../src/db/quotes'

const db = () => drizzle(env.DB)

describe('getDailyQuote', () => {
  it('returns the same quote for the same date', async () => {
    const a = await getDailyQuote(db(), '2026-04-12')
    const b = await getDailyQuote(db(), '2026-04-12')
    expect(a.text).toBe(b.text)
    expect(a.id).toBe(b.id)
  })

  it('has required fields', async () => {
    const q = await getDailyQuote(db(), '2026-04-12')
    expect(q.text).toBeTruthy()
    expect(['computing', 'poetry-tang', 'scifi', 'philosophy']).toContain(q.category)
    expect(['en', 'zh']).toContain(q.lang)
  })

  it('cycles through multiple quotes across 20 dates (has variance)', async () => {
    const seen = new Set<number>()
    for (let d = 1; d <= 20; d++) {
      const q = await getDailyQuote(db(), `2026-04-${String(d).padStart(2, '0')}`)
      seen.add(q.id)
    }
    // With 8 seed quotes and 20 dates, we expect at least 3 distinct quotes
    expect(seen.size).toBeGreaterThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd worker && pnpm vitest run test/db/quotes.test.ts
```

Expected: FAIL · missing module.

- [ ] **Step 3: Implement getDailyQuote**

`worker/src/db/quotes.ts`:

```ts
import { eq, asc } from 'drizzle-orm'
import { quotes } from './schema'
import type { Db } from './events'

export type QuoteRow = {
  id: number
  text: string
  attr: string | null
  category: 'computing' | 'poetry-tang' | 'scifi' | 'philosophy'
  lang: 'en' | 'zh'
}

/** Deterministic daily rotation: hash(YYYY-MM-DD) mod N. */
export async function getDailyQuote(db: Db, dateYmd: string): Promise<QuoteRow> {
  const rows = await db
    .select()
    .from(quotes)
    .where(eq(quotes.enabled, true))
    .orderBy(asc(quotes.id))
    .all()

  if (rows.length === 0) {
    throw new Error('No enabled quotes found. Seed the quotes table before calling /summary.')
  }

  const idx = fnv1a(dateYmd) % rows.length
  const chosen = rows[idx]!
  return {
    id: chosen.id,
    text: chosen.text,
    attr: chosen.attr,
    category: chosen.category,
    lang: chosen.lang,
  }
}

// Small non-cryptographic hash. 32-bit FNV-1a.
function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd worker && pnpm vitest run test/db/quotes.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/db/quotes.ts worker/test/db/quotes.test.ts
git commit -m "feat(worker): daily quote rotation via fnv hash"
```

---

## Task 15: Middleware · auth

**Files:**
- Create: `worker/test/middleware/auth.test.ts`
- Create: `worker/src/middleware/auth.ts`

- [ ] **Step 1: Write failing test**

`worker/test/middleware/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkBearer } from '../../src/middleware/auth'

describe('checkBearer', () => {
  it('returns true when header matches env token', () => {
    const h = new Headers({ Authorization: 'Bearer secret-token' })
    expect(checkBearer(h, 'secret-token')).toBe(true)
  })

  it('returns false when header is missing', () => {
    const h = new Headers()
    expect(checkBearer(h, 'secret-token')).toBe(false)
  })

  it('returns false when token is wrong', () => {
    const h = new Headers({ Authorization: 'Bearer wrong' })
    expect(checkBearer(h, 'secret-token')).toBe(false)
  })

  it('returns false when prefix is missing', () => {
    const h = new Headers({ Authorization: 'secret-token' })
    expect(checkBearer(h, 'secret-token')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd worker && pnpm vitest run test/middleware/auth.test.ts
```

Expected: FAIL · missing module.

- [ ] **Step 3: Implement checkBearer**

`worker/src/middleware/auth.ts`:

```ts
export function checkBearer(headers: Headers, expectedToken: string): boolean {
  const h = headers.get('Authorization')
  if (!h) return false
  const prefix = 'Bearer '
  if (!h.startsWith(prefix)) return false
  const provided = h.slice(prefix.length).trim()
  return constantTimeEqual(provided, expectedToken)
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd worker && pnpm vitest run test/middleware/auth.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/middleware/auth.ts worker/test/middleware/auth.test.ts
git commit -m "feat(worker): bearer auth check with constant-time compare"
```

---

## Task 16: Handler · POST /v1/ingest

**Files:**
- Create: `worker/test/routes/ingest.test.ts`
- Create: `worker/src/routes/ingest.ts`

- [ ] **Step 1: Write failing test**

`worker/test/routes/ingest.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { prices, events } from '../../src/db/schema'
import { ingestHandler } from '../../src/routes/ingest'
import { FALLBACK_MODEL } from '../../src/db/prices'

const db = () => drizzle(env.DB)

beforeEach(async () => {
  await db()
    .insert(prices)
    .values([
      {
        model: 'claude-sonnet-4-5',
        inputCostPerToken: 3e-6,
        outputCostPerToken: 15e-6,
        cacheReadInputTokenCost: 0.3e-6,
        cacheCreationInputTokenCost: 3.75e-6,
        updatedAt: 1744000000,
      },
      {
        model: FALLBACK_MODEL,
        inputCostPerToken: 5e-6,
        outputCostPerToken: 25e-6,
        cacheReadInputTokenCost: null,
        cacheCreationInputTokenCost: null,
        updatedAt: 1744000000,
      },
    ])
    .run()
})

const NOW = 1744430400

describe('ingestHandler', () => {
  it('inserts events and returns { accepted, deduped }', async () => {
    const result = await ingestHandler(
      {
        device_id: 'dev-1',
        events: [
          {
            tool: 'claude_code',
            event_uuid: 'u1',
            ts: NOW,
            model: 'claude-sonnet-4-5',
            input_tokens: 100,
            output_tokens: 50,
            cached_input_tokens: 0,
            cache_creation_tokens: 0,
            reasoning_output_tokens: 0,
          },
        ],
      },
      { db: db(), now: NOW },
    )
    expect(result.accepted).toBe(1)
    expect(result.deduped).toBe(0)

    const rows = await db().select().from(events).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.usdCost).toBeCloseTo(100 * 3e-6 + 50 * 15e-6, 6)
  })

  it('rejects events with ts skewed > 1 day from now', async () => {
    const futureTs = NOW + 86400 * 2
    await expect(
      ingestHandler(
        {
          device_id: 'dev-1',
          events: [
            {
              tool: 'claude_code',
              event_uuid: 'u1',
              ts: futureTs,
              model: 'claude-sonnet-4-5',
              input_tokens: 100,
              output_tokens: 0,
              cached_input_tokens: 0,
              cache_creation_tokens: 0,
              reasoning_output_tokens: 0,
            },
          ],
        },
        { db: db(), now: NOW },
      ),
    ).rejects.toThrow(/CLOCK_SKEW/)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd worker && pnpm vitest run test/routes/ingest.test.ts
```

Expected: FAIL · missing module.

- [ ] **Step 3: Implement ingestHandler**

`worker/src/routes/ingest.ts`:

```ts
import { insertEvents } from '../db/events'
import type { Db } from '../db/events'
import type { EventInput } from '../contract'

export type IngestInput = {
  device_id: string
  events: EventInput[]
}

export type IngestDeps = {
  db: Db
  now: number
}

const MAX_SKEW_SEC = 86400

export async function ingestHandler(input: IngestInput, deps: IngestDeps) {
  for (const e of input.events) {
    if (Math.abs(e.ts - deps.now) > MAX_SKEW_SEC) {
      throw new Error(`CLOCK_SKEW: event ts ${e.ts} differs from server now ${deps.now} by > 1 day`)
    }
  }
  return insertEvents(deps.db, input.device_id, input.events)
}
```

Note: the raised Error is translated to the oRPC `CLOCK_SKEW` error by the error middleware in Task 18. For direct testing we match on the string.

- [ ] **Step 4: Run tests, expect pass**

```bash
cd worker && pnpm vitest run test/routes/ingest.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/ingest.ts worker/test/routes/ingest.test.ts
git commit -m "feat(worker): ingest handler with clock skew guard"
```

---

## Task 17: Handler · GET /v1/summary

**Files:**
- Create: `worker/test/routes/summary.test.ts`
- Create: `worker/src/routes/summary.ts`

- [ ] **Step 1: Write failing test**

`worker/test/routes/summary.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { prices } from '../../src/db/schema'
import { insertEvents } from '../../src/db/events'
import { summaryHandler } from '../../src/routes/summary'
import { FALLBACK_MODEL } from '../../src/db/prices'
import type { EventInput } from '../../src/contract'

const db = () => drizzle(env.DB)
const TODAY_NOON = 1744430400
const TZ = 'Asia/Shanghai'

beforeEach(async () => {
  await db()
    .insert(prices)
    .values([
      {
        model: 'claude-sonnet-4-5',
        inputCostPerToken: 3e-6,
        outputCostPerToken: 15e-6,
        cacheReadInputTokenCost: 0.3e-6,
        cacheCreationInputTokenCost: 3.75e-6,
        updatedAt: 1744000000,
      },
      {
        model: FALLBACK_MODEL,
        inputCostPerToken: 5e-6,
        outputCostPerToken: 25e-6,
        cacheReadInputTokenCost: null,
        cacheCreationInputTokenCost: null,
        updatedAt: 1744000000,
      },
    ])
    .run()
})

const sample = (o: Partial<EventInput> = {}): EventInput => ({
  tool: 'claude_code',
  event_uuid: `u-${Math.random()}`,
  ts: TODAY_NOON,
  model: 'claude-sonnet-4-5',
  input_tokens: 1000,
  output_tokens: 500,
  cached_input_tokens: 0,
  cache_creation_tokens: 0,
  reasoning_output_tokens: 0,
  ...o,
})

describe('summaryHandler', () => {
  it('returns a complete summary payload with today, month, sparkline, quote, sync_ts', async () => {
    await insertEvents(db(), 'dev-1', [sample({ tool: 'claude_code' }), sample({ tool: 'cursor' })])
    const result = await summaryHandler({ db: db(), now: TODAY_NOON, tz: TZ })

    expect(result.today.tools).toHaveLength(2)
    expect(result.today.total_tokens).toBe((1000 + 500) * 2)
    expect(result.month.total_tokens).toBeGreaterThanOrEqual(result.today.total_tokens)
    expect(result.sparkline_7d).toHaveLength(7)
    expect(result.quote.text).toBeTruthy()
    expect(result.sync_ts).toBe(TODAY_NOON)
    expect(result.fallback_priced_tokens).toBe(0)
  })

  it('counts fallback_priced_tokens from events with used_fallback_price', async () => {
    await insertEvents(db(), 'dev-1', [
      sample({ model: 'gpt-unknown', input_tokens: 1500, output_tokens: 0 }),
    ])
    const result = await summaryHandler({ db: db(), now: TODAY_NOON, tz: TZ })
    expect(result.fallback_priced_tokens).toBe(1500)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd worker && pnpm vitest run test/routes/summary.test.ts
```

Expected: FAIL · missing module.

- [ ] **Step 3: Implement summaryHandler**

`worker/src/routes/summary.ts`:

```ts
import { sql } from 'drizzle-orm'
import { aggregateToday, aggregateMonth, sparkline7d } from '../db/aggregate'
import { getDailyQuote } from '../db/quotes'
import type { Db } from '../db/events'
import type { SummaryResponse } from '../contract'

export type SummaryDeps = { db: Db; now: number; tz: string }

export async function summaryHandler(deps: SummaryDeps): Promise<SummaryResponse> {
  const { db, now, tz } = deps

  const [today, month, sparkline, fallbackTokens] = await Promise.all([
    aggregateToday(db, now, tz),
    aggregateMonth(db, now, tz),
    sparkline7d(db, now, tz),
    sumFallbackPricedTokensToday(db, now, tz),
  ])

  const dateYmd = formatYmd(now, tz)
  const quote = await getDailyQuote(db, dateYmd)

  return {
    today: {
      total_tokens: today.total_tokens,
      total_usd: round2(today.total_usd),
      tools: today.tools.map((t) => ({ name: t.name, tokens: t.tokens, usd: round2(t.usd) })),
    },
    month: { total_tokens: month.total_tokens, total_usd: round2(month.total_usd) },
    sparkline_7d: sparkline,
    quote: { text: quote.text, attr: quote.attr ?? '', category: quote.category, lang: quote.lang },
    sync_ts: now,
    fallback_priced_tokens: fallbackTokens,
  }
}

async function sumFallbackPricedTokensToday(db: Db, now: number, tz: string): Promise<number> {
  if (tz !== 'Asia/Shanghai') throw new Error(`Unsupported tz: ${tz}`)
  const offsetSec = 8 * 3600
  const local = now + offsetSec
  const todayStart = local - (local % 86400) - offsetSec
  const row = await db.get<{ n: number }>(
    sql`
      SELECT CAST(COALESCE(SUM(input_tokens + output_tokens + cached_input_tokens + cache_creation_tokens + reasoning_output_tokens), 0) AS INTEGER) AS n
      FROM events
      WHERE ts >= ${todayStart} AND used_fallback_price = 1
    `,
  )
  return row?.n ?? 0
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function formatYmd(now: number, tz: string): string {
  if (tz !== 'Asia/Shanghai') throw new Error(`Unsupported tz: ${tz}`)
  const localMs = (now + 8 * 3600) * 1000
  const d = new Date(localMs)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd worker && pnpm vitest run test/routes/summary.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/summary.ts worker/test/routes/summary.test.ts
git commit -m "feat(worker): summary handler assembling today/month/sparkline/quote"
```

---

## Task 18: Middleware · error handler + oRPC wiring

**Files:**
- Create: `worker/src/middleware/errorHandler.ts`
- Create: `worker/src/router.ts`

- [ ] **Step 1: Write the error handler**

`worker/src/middleware/errorHandler.ts`:

```ts
import { os } from '../contract'

/** Translate thrown errors into structured oRPC errors. */
export const errorHandler = os.middleware(async ({ next }, _input, { errors }) => {
  try {
    return await next()
  } catch (e) {
    if (e instanceof Error) {
      if (e.message.startsWith('CLOCK_SKEW')) {
        throw errors.CLOCK_SKEW({ message: e.message })
      }
    }
    console.error('unhandled error', e)
    throw e
  }
})
```

- [ ] **Step 2: Write the router**

`worker/src/router.ts`:

```ts
import { drizzle } from 'drizzle-orm/d1'
import { os } from './contract'
import { ingestHandler } from './routes/ingest'
import { summaryHandler } from './routes/summary'
import { checkBearer } from './middleware/auth'
import { errorHandler } from './middleware/errorHandler'

const authMiddleware = os.middleware(async ({ next, context }, _input, { errors, request }) => {
  const req = request as Request
  if (!checkBearer(req.headers, context.env.TOKEI_BEARER_TOKEN)) {
    throw errors.UNAUTHORIZED({ message: 'Missing or invalid bearer token' })
  }
  return next()
})

const ingest = os.ingest
  .use(errorHandler)
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const db = drizzle(context.env.DB)
    return ingestHandler(input, { db, now: Math.floor(Date.now() / 1000) })
  })

const summary = os.summary
  .use(errorHandler)
  .use(authMiddleware)
  .handler(async ({ context }) => {
    const db = drizzle(context.env.DB)
    return summaryHandler({ db, now: Math.floor(Date.now() / 1000), tz: context.env.TOKEI_TIMEZONE })
  })

export const tokeiRouter = os.router({ ingest, summary })
```

- [ ] **Step 3: Type-check**

```bash
cd worker && pnpm build
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/middleware/errorHandler.ts worker/src/router.ts
git commit -m "feat(worker): router composing ingest+summary with auth+error middleware"
```

---

## Task 19: Cron · fetchPrices from LiteLLM

**Files:**
- Create: `worker/test/cron/fetchPrices.test.ts`
- Create: `worker/src/cron/fetchPrices.ts`

- [ ] **Step 1: Write failing test**

`worker/test/cron/fetchPrices.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { prices } from '../../src/db/schema'
import { fetchAndStorePrices } from '../../src/cron/fetchPrices'
import { eq } from 'drizzle-orm'

const db = () => drizzle(env.DB)

const MOCK_JSON = {
  'claude-sonnet-4-5': {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 15e-6,
    cache_read_input_token_cost: 0.3e-6,
    cache_creation_input_token_cost: 3.75e-6,
  },
  'claude-opus-4-6': {
    input_cost_per_token: 5e-6,
    output_cost_per_token: 25e-6,
    cache_read_input_token_cost: 0.5e-6,
    cache_creation_input_token_cost: 6.25e-6,
  },
  'gpt-4o': {
    input_cost_per_token: 2.5e-6,
    output_cost_per_token: 10e-6,
  },
  'sample_spec': {
    // Non-model entry to be skipped
    mode: 'chat',
  },
}

describe('fetchAndStorePrices', () => {
  it('parses LiteLLM JSON and upserts rows', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(MOCK_JSON), { status: 200 }))

    const stored = await fetchAndStorePrices(db(), 'https://fake.local/prices.json', fetcher)
    expect(stored).toBe(3) // 3 model entries with input_cost_per_token

    const sonnet = await db().select().from(prices).where(eq(prices.model, 'claude-sonnet-4-5')).get()
    expect(sonnet?.inputCostPerToken).toBe(3e-6)
    expect(sonnet?.outputCostPerToken).toBe(15e-6)

    const opus = await db().select().from(prices).where(eq(prices.model, 'claude-opus-4-6')).get()
    expect(opus?.inputCostPerToken).toBe(5e-6)
  })

  it('replaces existing rows (upsert behavior)', async () => {
    await db()
      .insert(prices)
      .values({
        model: 'claude-sonnet-4-5',
        inputCostPerToken: 999, // stale value
        outputCostPerToken: 999,
        cacheReadInputTokenCost: null,
        cacheCreationInputTokenCost: null,
        updatedAt: 1000,
      })
      .run()

    const fetcher = vi.fn(async () => new Response(JSON.stringify(MOCK_JSON), { status: 200 }))
    await fetchAndStorePrices(db(), 'https://fake.local/prices.json', fetcher)

    const row = await db().select().from(prices).where(eq(prices.model, 'claude-sonnet-4-5')).get()
    expect(row?.inputCostPerToken).toBe(3e-6)
  })

  it('throws on non-200 response', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 500 }))
    await expect(fetchAndStorePrices(db(), 'https://fake.local/prices.json', fetcher)).rejects.toThrow(/500/)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd worker && pnpm vitest run test/cron/fetchPrices.test.ts
```

Expected: FAIL · missing module.

- [ ] **Step 3: Implement fetchAndStorePrices**

`worker/src/cron/fetchPrices.ts`:

```ts
import { prices } from '../db/schema'
import type { Db } from '../db/events'

type LiteLlmEntry = {
  input_cost_per_token?: number
  output_cost_per_token?: number
  cache_read_input_token_cost?: number
  cache_creation_input_token_cost?: number
  // other fields ignored
}

export async function fetchAndStorePrices(
  db: Db,
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const res = await fetcher(url)
  if (!res.ok) {
    throw new Error(`LiteLLM price fetch failed: HTTP ${res.status}`)
  }
  const data = (await res.json()) as Record<string, LiteLlmEntry>

  const rows = Object.entries(data)
    .filter(([key, entry]) =>
      typeof entry === 'object' &&
      entry != null &&
      typeof entry.input_cost_per_token === 'number' &&
      typeof entry.output_cost_per_token === 'number' &&
      key !== 'sample_spec',
    )
    .map(([model, entry]) => ({
      model,
      inputCostPerToken: entry.input_cost_per_token as number,
      outputCostPerToken: entry.output_cost_per_token as number,
      cacheReadInputTokenCost: entry.cache_read_input_token_cost ?? null,
      cacheCreationInputTokenCost: entry.cache_creation_input_token_cost ?? null,
      updatedAt: Math.floor(Date.now() / 1000),
    }))

  // Chunk upserts to respect D1 parameter limits (~100 per statement safe margin).
  const CHUNK = 50
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    await db
      .insert(prices)
      .values(slice)
      .onConflictDoUpdate({
        target: prices.model,
        set: {
          inputCostPerToken: prices.inputCostPerToken,
          outputCostPerToken: prices.outputCostPerToken,
          cacheReadInputTokenCost: prices.cacheReadInputTokenCost,
          cacheCreationInputTokenCost: prices.cacheCreationInputTokenCost,
          updatedAt: prices.updatedAt,
        },
      })
      .run()
  }

  return rows.length
}
```

Note: the `onConflictDoUpdate.set` reference uses `prices.xxx` as column references; drizzle interprets these as "use the new value being inserted" (EXCLUDED.xxx). If this Drizzle behavior differs, fall back to a raw `INSERT ... ON CONFLICT(model) DO UPDATE SET input_cost_per_token = excluded.input_cost_per_token, ...` statement.

- [ ] **Step 4: Run tests, expect pass**

```bash
cd worker && pnpm vitest run test/cron/fetchPrices.test.ts
```

Expected: all 3 tests PASS. If the upsert test fails, switch to raw SQL upsert as noted.

- [ ] **Step 5: Commit**

```bash
git add worker/src/cron/fetchPrices.ts worker/test/cron/fetchPrices.test.ts
git commit -m "feat(worker): cron fetchAndStorePrices from litellm"
```

---

## Task 20: Main entry · index.ts

**Files:**
- Create: `worker/src/index.ts`

- [ ] **Step 1: Write the worker entry**

`worker/src/index.ts`:

```ts
import { RPCHandler } from '@orpc/server/fetch'
import { tokeiRouter } from './router'
import { fetchAndStorePrices } from './cron/fetchPrices'
import { drizzle } from 'drizzle-orm/d1'
import type { Env } from './env'

const rpcHandler = new RPCHandler(tokeiRouter)

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { matched, response } = await rpcHandler.handle(request, {
      context: { env, db: drizzle(env.DB) },
    })
    if (matched) return response
    return new Response('Not Found', { status: 404 })
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const db = drizzle(env.DB)
          const n = await fetchAndStorePrices(db, env.LITELLM_PRICE_URL)
          console.log(`fetchAndStorePrices: stored ${n} rows`)
        } catch (e) {
          console.error('scheduled fetchAndStorePrices failed', e)
        }
      })(),
    )
  },
}
```

Note: if `RPCHandler` is not the correct export for your installed oRPC version, consult the oRPC docs. The equivalent pattern is `router` → `fetch` adapter → `handle(request, { context })`.

- [ ] **Step 2: Type-check**

```bash
cd worker && pnpm build
```

Expected: no errors.

- [ ] **Step 3: Lint**

```bash
cd worker && pnpm lint
```

Expected: no errors.

- [ ] **Step 4: Run full test suite**

```bash
cd worker && pnpm test
```

Expected: all tests PASS (collector/fetch router adapter tests not yet written; existing unit tests still pass).

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): main entry wiring fetch+scheduled handlers"
```

---

## Task 21: Contract test · shared fixtures

**Files:**
- Create: `fixtures/events/claude_code_basic.json`
- Create: `fixtures/events/codex_with_reasoning.json`
- Create: `fixtures/events/cursor_with_usage_uuid.json`
- Create: `fixtures/events/gemini_otlp_shape.json`
- Create: `fixtures/events/unknown_model.json`
- Create: `worker/test/contract.test.ts`

- [ ] **Step 1: Write fixtures**

`fixtures/events/claude_code_basic.json`:

```json
{
  "tool": "claude_code",
  "event_uuid": "019b74c1-e87e-7ef2-91b3-f18518d58cce",
  "ts": 1744370123,
  "model": "claude-sonnet-4-5",
  "input_tokens": 8421,
  "cached_input_tokens": 5200,
  "output_tokens": 342,
  "cache_creation_tokens": 0,
  "reasoning_output_tokens": 0
}
```

`fixtures/events/codex_with_reasoning.json`:

```json
{
  "tool": "codex",
  "event_uuid": "019cdd8f-0ce7-71a0-80c7-af6dc1fe1794",
  "ts": 1744370200,
  "model": "gpt-5",
  "input_tokens": 13085,
  "cached_input_tokens": 6528,
  "output_tokens": 394,
  "cache_creation_tokens": 0,
  "reasoning_output_tokens": 247
}
```

`fixtures/events/cursor_with_usage_uuid.json`:

```json
{
  "tool": "cursor",
  "event_uuid": "28917e15-1a4b-4463-b214-c40f456d2fcb",
  "ts": 1744370250,
  "model": null,
  "input_tokens": 27909,
  "cached_input_tokens": 0,
  "output_tokens": 9129,
  "cache_creation_tokens": 0,
  "reasoning_output_tokens": 0
}
```

`fixtures/events/gemini_otlp_shape.json`:

```json
{
  "tool": "gemini",
  "event_uuid": "gemini-session-1-msg-42",
  "ts": 1744370300,
  "model": "gemini-2.5-pro",
  "input_tokens": 5000,
  "cached_input_tokens": 1000,
  "output_tokens": 800,
  "cache_creation_tokens": 0,
  "reasoning_output_tokens": 120
}
```

`fixtures/events/unknown_model.json`:

```json
{
  "tool": "claude_code",
  "event_uuid": "future-model-evt-1",
  "ts": 1744370400,
  "model": "claude-ultra-9000",
  "input_tokens": 1000,
  "cached_input_tokens": 0,
  "output_tokens": 500,
  "cache_creation_tokens": 0,
  "reasoning_output_tokens": 0
}
```

- [ ] **Step 2: Write contract test**

`worker/test/contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eventSchema } from '../src/contract'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(here, '../../fixtures/events')

const fixtures = [
  'claude_code_basic.json',
  'codex_with_reasoning.json',
  'cursor_with_usage_uuid.json',
  'gemini_otlp_shape.json',
  'unknown_model.json',
]

describe('shared event fixtures', () => {
  for (const name of fixtures) {
    it(`parses ${name} against eventSchema`, () => {
      const raw = readFileSync(resolve(fixturesDir, name), 'utf-8')
      const json = JSON.parse(raw)
      const result = eventSchema.safeParse(json)
      if (!result.success) console.error(result.error.issues)
      expect(result.success).toBe(true)
    })
  }
})
```

- [ ] **Step 3: Run contract test**

```bash
cd worker && pnpm vitest run test/contract.test.ts
```

Expected: all 5 fixture tests PASS.

- [ ] **Step 4: Commit**

```bash
git add fixtures/events/ worker/test/contract.test.ts
git commit -m "test(worker): shared event fixtures consumed by contract test"
```

---

## Task 22: Integration smoke · ingest then summary

**Files:**
- Create: `worker/test/integration.test.ts`

- [ ] **Step 1: Write the integration test**

`worker/test/integration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { prices } from '../src/db/schema'
import { ingestHandler } from '../src/routes/ingest'
import { summaryHandler } from '../src/routes/summary'
import { FALLBACK_MODEL } from '../src/db/prices'

const db = () => drizzle(env.DB)
const NOW = 1744430400
const TZ = 'Asia/Shanghai'

beforeEach(async () => {
  await db()
    .insert(prices)
    .values([
      {
        model: 'claude-sonnet-4-5',
        inputCostPerToken: 3e-6,
        outputCostPerToken: 15e-6,
        cacheReadInputTokenCost: 0.3e-6,
        cacheCreationInputTokenCost: 3.75e-6,
        updatedAt: NOW,
      },
      {
        model: FALLBACK_MODEL,
        inputCostPerToken: 5e-6,
        outputCostPerToken: 25e-6,
        cacheReadInputTokenCost: null,
        cacheCreationInputTokenCost: null,
        updatedAt: NOW,
      },
    ])
    .run()
})

describe('integration: ingest then summary', () => {
  it('produces a valid summary after ingesting events from 3 devices', async () => {
    await ingestHandler(
      {
        device_id: 'dev-1',
        events: [
          {
            tool: 'claude_code',
            event_uuid: 'e1',
            ts: NOW,
            model: 'claude-sonnet-4-5',
            input_tokens: 5000,
            output_tokens: 1000,
            cached_input_tokens: 0,
            cache_creation_tokens: 0,
            reasoning_output_tokens: 0,
          },
        ],
      },
      { db: db(), now: NOW },
    )

    await ingestHandler(
      {
        device_id: 'dev-2',
        events: [
          {
            tool: 'cursor',
            event_uuid: 'e2',
            ts: NOW,
            model: null,
            input_tokens: 3000,
            output_tokens: 500,
            cached_input_tokens: 0,
            cache_creation_tokens: 0,
            reasoning_output_tokens: 0,
          },
        ],
      },
      { db: db(), now: NOW },
    )

    await ingestHandler(
      {
        device_id: 'dev-3',
        events: [
          {
            tool: 'codex',
            event_uuid: 'e3',
            ts: NOW,
            model: 'claude-sonnet-4-5',
            input_tokens: 2000,
            output_tokens: 400,
            cached_input_tokens: 0,
            cache_creation_tokens: 0,
            reasoning_output_tokens: 50,
          },
        ],
      },
      { db: db(), now: NOW },
    )

    const summary = await summaryHandler({ db: db(), now: NOW, tz: TZ })

    expect(summary.today.total_tokens).toBe(5000 + 1000 + 3000 + 500 + 2000 + 400 + 50)
    expect(summary.today.tools).toHaveLength(3)
    expect(summary.fallback_priced_tokens).toBe(3000 + 500) // cursor event had null model
    expect(summary.quote.text).toBeTruthy()
    expect(summary.sparkline_7d).toHaveLength(7)
  })

  it('dedups repeated ingest of same events', async () => {
    const batch = {
      device_id: 'dev-1',
      events: [
        {
          tool: 'claude_code' as const,
          event_uuid: 'dup',
          ts: NOW,
          model: 'claude-sonnet-4-5',
          input_tokens: 1000,
          output_tokens: 500,
          cached_input_tokens: 0,
          cache_creation_tokens: 0,
          reasoning_output_tokens: 0,
        },
      ],
    }
    const r1 = await ingestHandler(batch, { db: db(), now: NOW })
    const r2 = await ingestHandler(batch, { db: db(), now: NOW })
    expect(r1).toEqual({ accepted: 1, deduped: 0 })
    expect(r2).toEqual({ accepted: 0, deduped: 1 })

    const summary = await summaryHandler({ db: db(), now: NOW, tz: TZ })
    expect(summary.today.total_tokens).toBe(1500) // not doubled
  })
})
```

- [ ] **Step 2: Run integration test**

```bash
cd worker && pnpm vitest run test/integration.test.ts
```

Expected: both integration tests PASS.

- [ ] **Step 3: Run full suite**

```bash
cd worker && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add worker/test/integration.test.ts
git commit -m "test(worker): end-to-end ingest+summary integration"
```

---

## Task 23: Deploy smoke (D1 provisioning + wrangler deploy)

**Files:**
- Modify: `worker/wrangler.toml` (replace placeholder database_id)

- [ ] **Step 1: Create D1 database**

```bash
cd worker && pnpm wrangler d1 create tokei
```

Expected output includes a line like:
```
database_id = "<uuid>"
```

Copy the `database_id` value.

- [ ] **Step 2: Update wrangler.toml with the actual database_id**

Replace `PLACEHOLDER_WILL_BE_SET_AT_DEPLOY` in `worker/wrangler.toml` with the real UUID.

- [ ] **Step 3: Apply migrations locally (dry run)**

```bash
cd worker && pnpm db:migrate:local
```

Expected: `✅ Successfully applied 2 migrations`

- [ ] **Step 4: Set secret**

```bash
cd worker && pnpm wrangler secret put TOKEI_BEARER_TOKEN
# prompts for value · enter a long random string
```

- [ ] **Step 5: Deploy**

```bash
cd worker && pnpm deploy
```

Expected: `Deployed tokei-worker triggers ...` with a `*.workers.dev` URL.

- [ ] **Step 6: Apply migrations to remote D1**

```bash
cd worker && pnpm db:migrate:prod
```

Expected: `✅ Successfully applied 2 migrations`

- [ ] **Step 7: Smoke test with curl**

```bash
TOKEI_URL=https://tokei-worker.<your-subdomain>.workers.dev
TOKEN=<bearer token you set>

# Should 401 without token
curl -i -X GET "$TOKEI_URL/v1/summary"

# Should 200 with token (empty summary · no events yet)
curl -i -H "Authorization: Bearer $TOKEN" "$TOKEI_URL/v1/summary"

# Ingest a test event
curl -i -X POST "$TOKEI_URL/v1/ingest" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"device_id":"smoke","events":[{"tool":"claude_code","event_uuid":"smoke-1","ts":'$(date +%s)',"model":"claude-sonnet-4-5","input_tokens":1000,"output_tokens":500,"cached_input_tokens":0,"cache_creation_tokens":0,"reasoning_output_tokens":0}]}'

# Summary should now show the event
curl -s -H "Authorization: Bearer $TOKEN" "$TOKEI_URL/v1/summary" | python3 -m json.tool
```

Expected:
- first curl: `401`
- second curl: `200`, `total_tokens: 0`, `quote.text: ...`
- third curl: `200`, `{"accepted":1,"deduped":0}`
- fourth curl: `200`, `today.total_tokens: 1500` (or matching value)

- [ ] **Step 8: Trigger cron manually and verify prices populated**

```bash
cd worker && pnpm wrangler cron trigger tokei-worker
cd worker && pnpm wrangler d1 execute tokei --remote --command "SELECT COUNT(*) FROM prices"
```

Expected: `COUNT(*)` > 0 (likely > 100 after LiteLLM fetch).

- [ ] **Step 9: Commit wrangler.toml with real database_id**

```bash
git add worker/wrangler.toml
git commit -m "chore(worker): wire deployed d1 database id"
```

---

## Final checklist (run after all tasks)

```bash
cd /Users/chichi/workspace/xx/tokei
pnpm --filter @tokei/worker run lint
pnpm --filter @tokei/worker run build
pnpm --filter @tokei/worker run test
```

All three should exit 0. If any fail, fix before declaring the worker subsystem complete.

---

## Follow-up work (not in this plan)

1. Full 80-quote seed (20 per category) · separate data task
2. Collector subsystem plan · next plan document
3. Firmware subsystem plan · third plan document
4. Optional `/v1/health` endpoint for manual checks
5. `/v1/health` endpoint: add after collector is producing real traffic
