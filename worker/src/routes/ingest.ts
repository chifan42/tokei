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

const MAX_FUTURE_SKEW_SEC = 86400

export async function ingestHandler(input: IngestInput, deps: IngestDeps) {
  // Only guard against events from the future (indicates a broken device clock).
  // Events from the past are valid backfill and are always accepted.
  for (const e of input.events) {
    if (e.ts - deps.now > MAX_FUTURE_SKEW_SEC) {
      throw new Error(`CLOCK_SKEW: event ts ${e.ts} is > 1 day in the future (server now ${deps.now})`)
    }
  }
  return insertEvents(deps.db, input.device_id, input.events)
}
