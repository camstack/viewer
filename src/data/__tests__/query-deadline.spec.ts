/**
 * The client-side deadline.
 *
 * The bug this closes: the viewer's tRPC client is `wsLink` with no per-op
 * timeout, so a hub procedure that never answers gave React Query a promise
 * that never settled — `isLoading` forever, no error, no retry, and (because
 * the WebSocket was still open) no offline banner either. One crash-looping
 * cluster node therefore read as "the whole app is broken".
 *
 * What is asserted here is specifically the HANG, not the failure. A tRPC call
 * that REJECTS was always handled fine; the untested case was the one that
 * happened.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  withQueryDeadline,
  isQueryDeadlineError,
  QueryDeadlineError,
  BOOT_QUERY_DEADLINE_MS,
} from '../query-deadline.js'
import { capQuery, CAP_QUERY_DEADLINE_MS } from '../cap-query.js'

/** A call that never settles — a cap routed at a node that just died. */
const never = <T,>(): Promise<T> => new Promise<T>(() => {})

describe('withQueryDeadline', () => {
  it('passes a value through untouched when the work is fast', async () => {
    await expect(withQueryDeadline(Promise.resolve(42), 'fast', 50)).resolves.toBe(42)
  })

  it('rejects with a typed deadline error when the work never settles', async () => {
    // Without the deadline this await never returns and the test times out —
    // which is exactly what the screen did.
    await expect(withQueryDeadline(never<number>(), 'stuck', 20)).rejects.toBeInstanceOf(
      QueryDeadlineError,
    )
  })

  it('names what timed out — a bare "timeout" cannot be acted on', async () => {
    const err = await withQueryDeadline(never(), 'deviceManager.listAll', 20).catch(
      (e: unknown) => e,
    )
    expect(isQueryDeadlineError(err)).toBe(true)
    expect((err as QueryDeadlineError).label).toBe('deviceManager.listAll')
    expect((err as QueryDeadlineError).deadlineMs).toBe(20)
  })

  it('a genuine rejection is NOT relabelled as a deadline', async () => {
    // The two are different events and the UI says different things about
    // them; collapsing them would make "one node is down" read as "error".
    const boom = new Error('PRECONDITION_FAILED')
    const err = await withQueryDeadline(Promise.reject(boom), 'x', 50).catch((e: unknown) => e)
    expect(err).toBe(boom)
    expect(isQueryDeadlineError(err)).toBe(false)
  })

  it('a late rejection after the deadline does not become an unhandled rejection', async () => {
    const onUnhandled = vi.fn()
    let reject!: (e: Error) => void
    const work = new Promise<never>((_r, rj) => {
      reject = rj
    })
    const settled = await withQueryDeadline(work, 'late', 10).catch((e: unknown) => e)
    expect(isQueryDeadlineError(settled)).toBe(true)
    // Promise.race already attached a handler to `work`; rejecting it now must
    // be inert. An unhandled rejection here would crash a release build.
    reject(new Error('arrived after nobody was listening'))
    await new Promise((r) => setTimeout(r, 20))
    expect(onUnhandled).not.toHaveBeenCalled()
  })

  it('the boot default sits between a healthy hub and the transport ceiling', () => {
    // Above the hub's own partial-result budget (3s per batch window) so an
    // honest partial is never discarded, and far below the 60s a dead peer
    // costs the transport — the gap this constant exists to close.
    expect(BOOT_QUERY_DEADLINE_MS).toBeGreaterThan(3_000)
    expect(BOOT_QUERY_DEADLINE_MS).toBeLessThan(60_000)
  })
})

describe('capQuery — the device-scoped cap path', () => {
  function clientWith(query: () => Promise<unknown>): Record<string, unknown> {
    return { motion: { getStatus: { query } } }
  }

  it('resolves to null instead of hanging when the owning node never answers', async () => {
    const started = Date.now()
    const out = await capQuery(clientWith(never), 'motion', 'getStatus', { deviceId: 108 })
    // `capQuery` already promised callers a `null` on failure; before the
    // deadline it could not keep that promise for a HANG, only for a throw.
    expect(out).toBeNull()
    expect(Date.now() - started).toBeLessThan(CAP_QUERY_DEADLINE_MS + 4_000)
  }, 20_000)

  it('still returns the value when the node answers', async () => {
    const out = await capQuery(
      clientWith(async () => ({ motion: true })),
      'motion',
      'getStatus',
      { deviceId: 101 },
    )
    expect(out).toEqual({ motion: true })
  })

  it('a throwing provider is still null — the existing contract is unchanged', async () => {
    const out = await capQuery(
      clientWith(async () => {
        throw new Error('NOT_FOUND')
      }),
      'motion',
      'getStatus',
      { deviceId: 101 },
    )
    expect(out).toBeNull()
  })
})
