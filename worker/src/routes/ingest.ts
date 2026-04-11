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
