/**
 * "This hub has no such procedure" — how a feature an older hub lacks is told
 * apart from a call that failed. tRPC answers a missing path with
 * `NOT_FOUND` ("No procedure found on path …"); matched structurally for the
 * same reason `unauthorized.ts` is.
 *
 * Only meaningful on a procedure that never answers NOT_FOUND itself.
 */
function readCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const code: unknown = Reflect.get(value, 'code')
  return typeof code === 'string' ? code : null
}

export function trpcErrorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null
  const direct = readCode(Reflect.get(err, 'data'))
  if (direct !== null) return direct
  const shape: unknown = Reflect.get(err, 'shape')
  return typeof shape === 'object' && shape !== null ? readCode(Reflect.get(shape, 'data')) : null
}

export function isMissingProcedureError(err: unknown): boolean {
  if (trpcErrorCode(err) === 'NOT_FOUND') return true
  const message: unknown = typeof err === 'object' && err !== null ? Reflect.get(err, 'message') : null
  return typeof message === 'string' && (message.startsWith('NOT_FOUND') || message.includes('No procedure found'))
}
