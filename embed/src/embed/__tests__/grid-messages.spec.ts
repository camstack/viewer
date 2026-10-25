import { describe, it, expect, vi } from 'vitest'
import {
  tileTapMsg,
  tileLongPressMsg,
  gridStateMsg,
  layoutMsg,
  postToHost,
  cellPanelOpenMsg,
} from '../grid-messages'

describe('grid message builders', () => {
  const rect = { x: 1, y: 2, w: 3, h: 4 }

  it('builds a tileTap message', () => {
    expect(tileTapMsg(7, rect)).toEqual({ type: 'tileTap', deviceId: 7, rect })
  })

  it('builds a tileLongPress message', () => {
    expect(tileLongPressMsg(8, rect)).toEqual({ type: 'tileLongPress', deviceId: 8, rect })
  })

  it('builds a cellPanelOpen message for each panel the host mounts', () => {
    expect(cellPanelOpenMsg(7, 'devices')).toEqual({
      type: 'cellPanelOpen',
      deviceId: 7,
      panel: 'devices',
    })
    expect(cellPanelOpenMsg(7, 'viewOptions')).toEqual({
      type: 'cellPanelOpen',
      deviceId: 7,
      panel: 'viewOptions',
    })
    expect(cellPanelOpenMsg(7, 'actions')).toEqual({
      type: 'cellPanelOpen',
      deviceId: 7,
      panel: 'actions',
    })
  })

  it('builds a grid state message with optional detail', () => {
    expect(gridStateMsg('ready')).toEqual({ type: 'state', state: 'ready' })
    expect(gridStateMsg('error', 'boom')).toEqual({
      type: 'state',
      state: 'error',
      message: 'boom',
    })
  })

  it('builds a layout message', () => {
    expect(layoutMsg([{ deviceId: 7, rect }])).toEqual({
      type: 'layout',
      tiles: [{ deviceId: 7, rect }],
    })
  })

  it('postToHost serializes via ReactNativeWebView when present', () => {
    const postMessage = vi.fn()
    ;(window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView = { postMessage }
    postToHost(tileTapMsg(7, rect))
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify(tileTapMsg(7, rect)))
    delete (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView
  })

  it('postToHost is a no-op when no host bridge exists', () => {
    delete (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView
    expect(() => postToHost(gridStateMsg('ready'))).not.toThrow()
  })
})
