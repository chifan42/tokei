import { beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

beforeEach(async () => {
  await env.DB.exec('DROP TABLE IF EXISTS events;')
  await env.DB.exec('DROP TABLE IF EXISTS prices;')
  await env.DB.exec('DROP TABLE IF EXISTS quotes;')
  await env.DB.exec('DROP INDEX IF EXISTS idx_events_ts_tool;')

  await env.DB.exec(
    'CREATE TABLE events (device_id text NOT NULL, tool text NOT NULL, event_uuid text NOT NULL, ts integer NOT NULL, model text, input_tokens integer DEFAULT 0 NOT NULL, cached_input_tokens integer DEFAULT 0 NOT NULL, output_tokens integer DEFAULT 0 NOT NULL, cache_creation_tokens integer DEFAULT 0 NOT NULL, reasoning_output_tokens integer DEFAULT 0 NOT NULL, usd_cost real, used_fallback_price integer DEFAULT 0 NOT NULL, PRIMARY KEY(device_id, tool, event_uuid));',
  )
  await env.DB.exec('CREATE INDEX idx_events_ts_tool ON events (ts, tool);')

  await env.DB.exec(
    'CREATE TABLE prices (model text PRIMARY KEY NOT NULL, input_cost_per_token real NOT NULL, output_cost_per_token real NOT NULL, cache_read_input_token_cost real, cache_creation_input_token_cost real, updated_at integer NOT NULL);',
  )

  await env.DB.exec(
    "CREATE TABLE quotes (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, text text NOT NULL, attr text, category text NOT NULL, lang text DEFAULT 'en' NOT NULL, enabled integer DEFAULT 1 NOT NULL);",
  )

  await env.DB.exec(
    "INSERT INTO quotes (text, attr, category, lang) VALUES ('Premature optimization is the root of all evil.', 'Donald Knuth', 'computing', 'en'), ('Simplicity is prerequisite for reliability.', 'Edsger Dijkstra', 'computing', 'en'), ('行到水穷处，坐看云起时。', '王维《终南别业》', 'poetry-tang', 'zh'), ('欲穷千里目，更上一层楼。', '王之涣《登鹳雀楼》', 'poetry-tang', 'zh'), ('弱小和无知不是生存的障碍，傲慢才是。', '刘慈欣《三体》', 'scifi', 'zh'), ('The future is already here. It is just not evenly distributed.', 'William Gibson', 'scifi', 'en'), ('The limits of my language mean the limits of my world.', 'Wittgenstein', 'philosophy', 'en'), ('人是被抛入这个世界的。', 'Heidegger', 'philosophy', 'zh');",
  )
})
