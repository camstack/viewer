/**
 * Central detection of a "session no longer valid" error from the hub.
 *
 * Every data query/mutation flows through the SDK's tRPC client; when the
 * session token has expired or been revoked, the hub answers with a tRPC
 * `UNAUTHORIZED` error. The app must treat that as "logged out" — clear the
 * stale token and fall back to the login screen — instead of surfacing a raw
 * "unauthorized" message and stranding the user (FIX 1).
 *
 * We match structurally (no `TRPCClientError` import) so this stays decoupled
 * from the SDK's error class identity across the self-contained-addon
 * boundary. Only `UNAUTHORIZED` counts — a `FORBIDDEN` on a single
 * permission-gated cap must NOT log the user out.
 */

function readCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const code = Reflect.get(value, 'code')
  return typeof code === 'string' ? code : null
}

/** True when `err` is (or wraps) a tRPC `UNAUTHORIZED` rejection. */
export function isUnauthorizedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false

  // tRPC client errors expose the server code at `err.data.code`, and the
  // full shape at `err.shape.data.code`. Check both.
  const data = Reflect.get(err, 'data')
  if (readCode(data) === 'UNAUTHORIZED') return true
  const shape = Reflect.get(err, 'shape')
  if (typeof shape === 'object' && shape !== null && readCode(Reflect.get(shape, 'data')) === 'UNAUTHORIZED') {
    return true
  }

  // Last-resort: some transports flatten the code into the message.
  const message = Reflect.get(err, 'message')
  return typeof message === 'string' && message.includes('UNAUTHORIZED')
}
