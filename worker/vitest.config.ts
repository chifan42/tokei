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
