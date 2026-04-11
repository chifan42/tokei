import { beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

beforeEach(async () => {
  // Will be fully populated in Task 6 with seed quotes
  void env
})
