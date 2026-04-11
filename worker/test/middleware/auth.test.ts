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
