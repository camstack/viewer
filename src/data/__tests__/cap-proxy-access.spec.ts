/**
 * Regression: the accessory-control cap access (status reads + mutations) must
 * work against a REAL tRPC v11 client, whose proxy nodes are callable
 * `Proxy(noop)` values (`typeof === 'function'`), NOT plain objects. The old
 * `typeof === 'object'` guards rejected every such node, so every accessory
 * control silently no-op'd on tap and never showed real state.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolveMutate } from '../use-accessory-controls.js'
import { isStatusRouter } from '../use-cap-status.js'

/** Minimal stand-in for tRPC v11's `createRecursiveProxy` — every path is a
 *  callable `Proxy(noop)`, and calling a leaf invokes `callback({ path, args })`
 *  (exactly the runtime shape of `system.trpcClient.<cap>.<method>.<op>`). */
function makeTrpcProxy(callback: (path: readonly string[], args: readonly unknown[]) => unknown): unknown {
  const noop = (): void => {}
  const build = (path: readonly string[]): unknown =>
    new Proxy(noop, {
      get: (_t, key) => (typeof key === 'string' && key !== 'then' ? build([...path, key]) : undefined),
      apply: (_t, _this, args) => callback(path, args),
    })
  return build([])
}

describe('cap proxy access (tRPC v11 client shape)', () => {
  it('resolveMutate finds .mutate on a proxy cap node and calls it', async () => {
    const calls: { path: readonly string[]; args: readonly unknown[] }[] = []
    const client = makeTrpcProxy((path, args) => {
      calls.push({ path, args })
      return Promise.resolve(undefined)
    })
    const router = (client as Record<string, unknown>).switch

    const fn = resolveMutate(router, 'setState')
    expect(fn).toBeTypeOf('function')

    await fn!({ deviceId: 7, on: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.path).toEqual(['switch', 'setState', 'mutate'])
    expect(calls[0]!.args).toEqual([{ deviceId: 7, on: true }])
  })

  it('isStatusRouter accepts a proxy cap node exposing getStatus.query', () => {
    const client = makeTrpcProxy(() => Promise.resolve({ on: false }))
    const router = (client as Record<string, unknown>).switch
    expect(isStatusRouter(router)).toBe(true)
  })

  it('still accepts a plain-object router (test doubles) and rejects garbage', () => {
    expect(isStatusRouter({ getStatus: { query: vi.fn() } })).toBe(true)
    expect(resolveMutate({ setState: { mutate: vi.fn() } }, 'setState')).toBeTypeOf('function')

    expect(isStatusRouter(null)).toBe(false)
    expect(isStatusRouter({ getStatus: { query: 123 } })).toBe(false)
    expect(resolveMutate(null, 'setState')).toBeNull()
    expect(resolveMutate({ setState: {} }, 'setState')).toBeNull()
  })
})
