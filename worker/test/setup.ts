// Global test setup: applies migrations to the ephemeral D1 database.
// Populated in Task 6 once the migrations directory exists.
import { beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

beforeEach(async () => {
  // placeholder · real migration apply happens in Task 6
  void env
})
