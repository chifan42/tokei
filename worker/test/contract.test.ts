import { describe, it, expect } from 'vitest'
import { eventSchema } from '../src/contract'

const fixtures: Record<string, unknown> = {
  'claude_code_basic': {
    tool: 'claude_code',
    event_uuid: '019b74c1-e87e-7ef2-91b3-f18518d58cce',
    ts: 1744370123,
    model: 'claude-sonnet-4-5',
    input_tokens: 8421,
    cached_input_tokens: 5200,
    output_tokens: 342,
    cache_creation_tokens: 0,
    reasoning_output_tokens: 0,
  },
  'codex_with_reasoning': {
    tool: 'codex',
    event_uuid: '019cdd8f-0ce7-71a0-80c7-af6dc1fe1794',
    ts: 1744370200,
    model: 'gpt-5',
    input_tokens: 13085,
    cached_input_tokens: 6528,
    output_tokens: 394,
    cache_creation_tokens: 0,
    reasoning_output_tokens: 247,
  },
  'cursor_with_usage_uuid': {
    tool: 'cursor',
    event_uuid: '28917e15-1a4b-4463-b214-c40f456d2fcb',
    ts: 1744370250,
    model: null,
    input_tokens: 27909,
    cached_input_tokens: 0,
    output_tokens: 9129,
    cache_creation_tokens: 0,
    reasoning_output_tokens: 0,
  },
  'gemini_otlp_shape': {
    tool: 'gemini',
    event_uuid: 'gemini-session-1-msg-42',
    ts: 1744370300,
    model: 'gemini-2.5-pro',
    input_tokens: 5000,
    cached_input_tokens: 1000,
    output_tokens: 800,
    cache_creation_tokens: 0,
    reasoning_output_tokens: 120,
  },
  'unknown_model': {
    tool: 'claude_code',
    event_uuid: 'future-model-evt-1',
    ts: 1744370400,
    model: 'claude-ultra-9000',
    input_tokens: 1000,
    cached_input_tokens: 0,
    output_tokens: 500,
    cache_creation_tokens: 0,
    reasoning_output_tokens: 0,
  },
}

describe('shared event fixtures', () => {
  for (const [name, json] of Object.entries(fixtures)) {
    it(`parses ${name} against eventSchema`, () => {
      const result = eventSchema.safeParse(json)
      if (!result.success) console.error(result.error.issues)
      expect(result.success).toBe(true)
    })
  }
})
