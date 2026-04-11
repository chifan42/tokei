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
