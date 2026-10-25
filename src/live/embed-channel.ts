/**
 * Per-device command channel between a player iframe (`LiveView.web`) and other
 * web consumers (`use-intercom.web`). The player owns the iframe and registers a
 * channel keyed by deviceId; the intercom hook posts `setMic` and subscribes to
 * `micState`. Pure (no DOM). Unused on native.
 */
import type { MicState, PlayerCommand } from './embed-player-messages.js'

export interface EmbedChannel {
  readonly postCommand: (command: PlayerCommand) => void
  readonly getMicState: () => MicState
  readonly setMicState: (state: MicState) => void
  readonly subscribeMicState: (cb: (state: MicState) => void) => () => void
  unregister?: () => void
}

export function createEmbedChannel(send: (command: PlayerCommand) => void = () => {}): EmbedChannel {
  let micState: MicState = 'idle'
  const subs = new Set<(state: MicState) => void>()
  return {
    postCommand: (command) => send(command),
    getMicState: () => micState,
    setMicState: (state) => {
      micState = state
      for (const cb of subs) cb(state)
    },
    subscribeMicState: (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
  }
}

const registry = new Map<number, EmbedChannel>()

export function registerEmbedChannel(deviceId: number, channel: EmbedChannel): () => void {
  const off = (): void => {
    if (registry.get(deviceId) === channel) registry.delete(deviceId)
  }
  channel.unregister = off
  registry.set(deviceId, channel)
  return off
}

export function getEmbedChannel(deviceId: number): EmbedChannel | undefined {
  return registry.get(deviceId)
}
