import { describe, it, expect, vi, afterEach } from 'vitest'
import { emitHost, isInIframe, onHostCommand, acquireConfig } from '../host-bridge'

afterEach(() => {
  delete (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView
})

describe('isInIframe', () => {
  it('is false in a top-level window (window.parent === window)', () => {
    expect(isInIframe()).toBe(false)
  })
})

describe('emitHost', () => {
  it('serializes via ReactNativeWebView when present (native path)', () => {
    const postMessage = vi.fn()
    ;(window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView = { postMessage }
    emitHost({ type: 'state', state: 'ready' })
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ type: 'state', state: 'ready' }))
  })

  it('is a no-op when there is neither a RN bridge nor a parent frame', () => {
    expect(() => emitHost({ type: 'state', state: 'ready' })).not.toThrow()
  })
})

describe('onHostCommand', () => {
  it('invokes the handler with the command payload on an embed-command message', () => {
    const handler = vi.fn()
    const off = onHostCommand(handler)
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'embed-command', command: { kind: 'setQuality', value: 'high' } },
      }),
    )
    expect(handler).toHaveBeenCalledWith({ kind: 'setQuality', value: 'high' })
    off()
  })

  it('ignores non-embed-command messages', () => {
    const handler = vi.fn()
    const off = onHostCommand(handler)
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'something-else' } }))
    window.dispatchEvent(new MessageEvent('message', { data: 'junk' }))
    expect(handler).not.toHaveBeenCalled()
    off()
  })

  it('stops listening after cleanup', () => {
    const handler = vi.fn()
    const off = onHostCommand(handler)
    off()
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'embed-command', command: { kind: 'reconnect' } },
      }),
    )
    expect(handler).not.toHaveBeenCalled()
  })
})

type Cfg = { id: number }
const parseCfg = (raw: unknown): import('../host-bridge').ConfigResult<Cfg> => {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as Record<string, unknown>).id === 'number'
  ) {
    return { ok: true, config: { id: (raw as Record<string, unknown>).id as number } }
  }
  return { ok: false, error: 'bad config' }
}

describe('acquireConfig', () => {
  it('resolves synchronously from the injected global (native path)', async () => {
    const r = await acquireConfig('player', () => ({ id: 42 }), parseCfg)
    expect(r).toEqual({ ok: true, config: { id: 42 } })
  })

  it('returns ok:false when no global and not in an iframe', async () => {
    const r = await acquireConfig('player', () => undefined, parseCfg)
    expect(r.ok).toBe(false)
  })

  it('uses the URL source when no global and not in an iframe (standalone share link)', async () => {
    const r = await acquireConfig(
      'grid',
      () => undefined,
      parseCfg,
      () => ({
        ok: true,
        config: { id: 7 },
      }),
    )
    expect(r).toEqual({ ok: true, config: { id: 7 } })
  })

  it('surfaces a URL-source error verbatim (share link with a bad param)', async () => {
    const r = await acquireConfig(
      'grid',
      () => undefined,
      parseCfg,
      () => ({
        ok: false,
        error: 'share token missing',
      }),
    )
    expect(r).toEqual({ ok: false, error: 'share token missing' })
  })

  it('falls back to the config-global error when the URL source returns null', async () => {
    const r = await acquireConfig(
      'grid',
      () => undefined,
      parseCfg,
      () => null,
    )
    expect(r).toEqual({ ok: false, error: 'config global for mode "grid" is not set' })
  })

  it('prefers the injected global over the URL source', async () => {
    const readUrl = vi.fn(() => ({ ok: true as const, config: { id: 99 } }))
    const r = await acquireConfig('grid', () => ({ id: 1 }), parseCfg, readUrl)
    expect(r).toEqual({ ok: true, config: { id: 1 } })
    expect(readUrl).not.toHaveBeenCalled()
  })
})
