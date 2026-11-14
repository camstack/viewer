import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLogVerbose, useLogStore } from '../../lib/logger.js'
import {
  DEVICE_EMBED_SCOPE,
  deviceEmbedMessageMark,
  markDeviceEmbed,
  noteDeviceEmbedTap,
  resetDeviceEmbedClock,
} from '../device-embed-timing.js'

function embedLines(): { msg: string; data: unknown }[] {
  return useLogStore
    .getState()
    .entries.filter((e) => e.scope === DEVICE_EMBED_SCOPE)
    .map((e) => ({ msg: e.msg, data: e.data }))
}

describe('device embed timing marks', () => {
  afterEach(() => {
    vi.useRealTimers()
    setLogVerbose(false)
    resetDeviceEmbedClock()
    useLogStore.getState().clear()
  })

  it('writes nothing unless debug mode is on', () => {
    setLogVerbose(false)
    noteDeviceEmbedTap(22)
    markDeviceEmbed('load-end', 22)
    expect(embedLines()).toEqual([])
  })

  it('records one line per mark with ms since the tap and the device id', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    setLogVerbose(true)
    noteDeviceEmbedTap(22)
    vi.setSystemTime(1_000_040)
    markDeviceEmbed('webview-created', 22)
    vi.setSystemTime(1_000_180)
    markDeviceEmbed('load-start', 22)
    vi.setSystemTime(1_000_900)
    markDeviceEmbed('load-end', 22)
    vi.setSystemTime(1_001_400)
    markDeviceEmbed('card-ready', 22)
    vi.setSystemTime(1_001_420)
    markDeviceEmbed('visible', 22)
    expect(embedLines()).toEqual([
      { msg: 'tap', data: { deviceId: 22, sinceTapMs: 0 } },
      { msg: 'webview-created', data: { deviceId: 22, sinceTapMs: 40 } },
      { msg: 'load-start', data: { deviceId: 22, sinceTapMs: 180 } },
      { msg: 'load-end', data: { deviceId: 22, sinceTapMs: 900 } },
      { msg: 'card-ready', data: { deviceId: 22, sinceTapMs: 1400 } },
      { msg: 'visible', data: { deviceId: 22, sinceTapMs: 1420 } },
    ])
  })

  it('does not restart the clock when the screen notes the same tap again', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000)
    setLogVerbose(true)
    noteDeviceEmbedTap(7)
    vi.setSystemTime(5_200)
    noteDeviceEmbedTap(7)
    markDeviceEmbed('load-end', 7)
    expect(embedLines()).toEqual([
      { msg: 'tap', data: { deviceId: 7, sinceTapMs: 0 } },
      { msg: 'load-end', data: { deviceId: 7, sinceTapMs: 200 } },
    ])
  })

  it('starts a new clock for a different device', () => {
    vi.useFakeTimers()
    vi.setSystemTime(8_000)
    setLogVerbose(true)
    noteDeviceEmbedTap(1)
    vi.setSystemTime(8_500)
    noteDeviceEmbedTap(2)
    expect(embedLines()[1]).toEqual({ msg: 'tap', data: { deviceId: 2, sinceTapMs: 0 } })
  })

  it('treats only a card-ready JSON message as the ready signal', () => {
    expect(deviceEmbedMessageMark('{"type":"card-ready"}')).toBe('card-ready')
    expect(deviceEmbedMessageMark('{"type":"state","state":"playing"}')).toBeNull()
    expect(deviceEmbedMessageMark('not-json')).toBeNull()
  })
})
