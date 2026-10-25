import { describe, it, expect, vi, afterEach } from 'vitest'

import {
  SnapshotBroker,
  parseSnapshotPayload,
  parseSnapshotMessage,
} from '../frame-snapshot-protocol.js'
import { playbackCommandToMessage, playbackCommandToScript } from '../live-control-map.js'
import { LIVE_VIEW_HANDLE_METHODS } from '../live-view-types.js'

afterEach(() => vi.useRealTimers())

describe('the page → host snapshot messages', () => {
  it('parses a frame and an error, from an object or a WebView string', () => {
    const ok = { type: 'snapshot', id: 's1', base64: 'AAAA', width: 640, height: 360 }
    expect(parseSnapshotMessage(ok)).toEqual({
      type: 'snapshot',
      id: 's1',
      frame: { mime: 'image/jpeg', base64: 'AAAA', width: 640, height: 360 },
    })
    expect(parseSnapshotPayload(JSON.stringify(ok))?.type).toBe('snapshot')
    expect(parseSnapshotPayload(JSON.stringify({ type: 'snapshotError', id: 's1', message: 'no frame' }))).toEqual({
      type: 'snapshotError',
      id: 's1',
      message: 'no frame',
    })
  })

  it('ignores anything else, including an empty frame', () => {
    expect(parseSnapshotPayload('{"type":"state"}')).toBeNull()
    expect(parseSnapshotPayload('plain')).toBeNull()
    expect(parseSnapshotMessage({ type: 'snapshot', id: 's1', base64: '', width: 1, height: 1 })).toBeNull()
    expect(parseSnapshotMessage({ type: 'snapshot', base64: 'A', width: 1, height: 1 })).toBeNull()
  })
})

describe('SnapshotBroker', () => {
  it('pairs the answer with its request by id', async () => {
    const broker = new SnapshotBroker()
    let sent = ''
    const pending = broker.request((id) => {
      sent = id
    })
    broker.accept({ type: 'snapshot', id: sent, frame: { mime: 'image/jpeg', base64: 'AAAA', width: 2, height: 2 } })
    await expect(pending).resolves.toMatchObject({ base64: 'AAAA' })
  })

  it('rejects with the page\'s reason', async () => {
    const broker = new SnapshotBroker()
    let sent = ''
    const pending = broker.request((id) => {
      sent = id
    })
    broker.accept({ type: 'snapshotError', id: sent, message: 'no frame' })
    await expect(pending).rejects.toThrow('no frame')
  })

  it('times out when an older cached page never answers', async () => {
    vi.useFakeTimers()
    const broker = new SnapshotBroker()
    const pending = broker.request(() => undefined, 500)
    const assertion = expect(pending).rejects.toThrow('snapshot timeout')
    await vi.advanceTimersByTimeAsync(600)
    await assertion
  })

  it('a late answer to a timed-out request cannot satisfy the next one', async () => {
    vi.useFakeTimers()
    const broker = new SnapshotBroker()
    let first = ''
    const stale = broker.request((id) => { first = id }, 100)
    const staleAssertion = expect(stale).rejects.toThrow('timeout')
    await vi.advanceTimersByTimeAsync(200)
    await staleAssertion
    let second = ''
    const fresh = broker.request((id) => { second = id })
    expect(second).not.toBe(first)
    broker.accept({ type: 'snapshot', id: first, frame: { mime: 'image/jpeg', base64: 'OLD', width: 1, height: 1 } })
    broker.accept({ type: 'snapshot', id: second, frame: { mime: 'image/jpeg', base64: 'NEW', width: 1, height: 1 } })
    await expect(fresh).resolves.toMatchObject({ base64: 'NEW' })
  })
})

describe('the command reaches the page on both transports', () => {
  it('injects the embed call on native and posts the message on the web', () => {
    expect(playbackCommandToScript({ kind: 'snapshot', id: 's9' })).toContain('window.__camstackEmbed.snapshot("s9")')
    expect(playbackCommandToMessage({ kind: 'snapshot', id: 's9' })).toEqual({ kind: 'snapshot', id: 's9' })
  })

  it('every live view variant exposes captureSnapshot', () => {
    expect(LIVE_VIEW_HANDLE_METHODS).toContain('captureSnapshot')
  })
})
