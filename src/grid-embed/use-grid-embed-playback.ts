/**
 * The grid embed's side of the timeline broadcast.
 *
 * A timeline publishes a moment onto `gridPlaybackBus`; this turns each
 * verb into the matching `GridCommand` and hands it to whichever transport the
 * platform uses — `injectJavaScript` on the native WebView, `postMessage` on the
 * web iframe. Both variants of `GridLiveEmbed` therefore add ONE line, and
 * neither learns anything about the timeline.
 *
 * ONE sink stands for the whole wall: the embed page applies a grid-wide
 * command to every tile itself, so registering per-tile sinks from here would
 * send N identical commands down one channel.
 */
import { useCallback, useEffect } from 'react'
import { gridPlaybackBus, type GridPlaybackSink } from '../live/playback-bus.js'
import type { GridCommand } from './embed-messages.js'

/** Bus key for the single embed sink. Constant: a remount must REPLACE the
 *  previous sink, not add a second one that double-seeks. */
export const GRID_EMBED_SINK_KEY = 'grid-embed'

/** Map the bus verbs onto grid commands. Pure — the transport is the caller's. */
export function createGridEmbedPlaybackSink(
  send: (cmd: GridCommand) => void,
): GridPlaybackSink {
  return {
    scrubStart: (): void => send({ kind: 'scrubStart' }),
    scrubTo: (epochMs: number): void => send({ kind: 'scrubTo', value: epochMs }),
    scrubCommit: (epochMs: number): void => send({ kind: 'scrubCommit', value: epochMs }),
    seek: (epochMs: number): void => send({ kind: 'seek', value: epochMs }),
    setRate: (rate: number): void => send({ kind: 'setRate', value: rate }),
    goLive: (): void => send({ kind: 'goLive' }),
  }
}

/**
 * Register the embed as the grid's player surface for as long as it is mounted.
 *
 * `send` is kept out of the effect's identity on purpose — the transports are
 * `useCallback`s over a ref, and re-registering on every render would churn the
 * bus without changing what it reaches.
 */
export function useGridEmbedPlaybackSink(send: (cmd: GridCommand) => void): void {
  const sendRef = useCallback((cmd: GridCommand): void => send(cmd), [send])
  useEffect(() => {
    return gridPlaybackBus.register(GRID_EMBED_SINK_KEY, createGridEmbedPlaybackSink(sendRef))
  }, [sendRef])
}
