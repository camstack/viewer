/**
 * Player (single-camera) embed message vocabulary, mirroring the server
 * `EmbedPlayerPage` contract. `PlayerCommand` = host→embed; `PlayerHostMessage`
 * = embed→host (state / micState). Pure.
 */
import type { WebrtcTarget } from './signaling-types.js'
import type { GridHighlightEmbedConfig } from '../grid-embed/embed-config.js'

export type EmbedPlayerState = 'connecting' | 'playing' | 'error'
export type MicState = 'idle' | 'starting' | 'talking' | 'error'

export type PlayerCommand =
  | { readonly kind: 'setMuted'; readonly value: boolean }
  | { readonly kind: 'setTarget'; readonly value: WebrtcTarget }
  | { readonly kind: 'setStats'; readonly value: boolean }
  | { readonly kind: 'setHighlight'; readonly value: GridHighlightEmbedConfig }
  | { readonly kind: 'setSnapshot'; readonly value: string }
  | { readonly kind: 'setMic'; readonly value: boolean }
  | { readonly kind: 'fit'; readonly w: number; readonly h: number }
  | { readonly kind: 'reconnect' }
  /** Host pushed a renewed access token (D812). Page: `__camstackEmbedPage.setToken`. */
  | { readonly kind: 'setToken'; readonly value: string }

// `setDevice` is deliberately NOT here. The in-place camera swap (D483) lives
// in the SHARED `PlaybackCommand` vocabulary (`live-control-map.ts`) with the
// native and web encoders beside each other, because both player variants send
// it and a second copy in this union is exactly the fork those encoders exist
// to prevent.

export type PlayerHostMessage =
  | { readonly type: 'state'; readonly state: EmbedPlayerState; readonly message?: string }
  | { readonly type: 'micState'; readonly state: MicState }

const PLAYER_STATES: readonly EmbedPlayerState[] = ['connecting', 'playing', 'error']
const MIC_STATES: readonly MicState[] = ['idle', 'starting', 'talking', 'error']

/** Validate an already-parsed embed→host message object (web postMessage). */
export function coercePlayerHostMessage(data: unknown): PlayerHostMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const m = data as Record<string, unknown>
  if (m.type === 'state' && typeof m.state === 'string' && PLAYER_STATES.includes(m.state as EmbedPlayerState)) {
    const state = m.state as EmbedPlayerState
    return typeof m.message === 'string' ? { type: 'state', state, message: m.message } : { type: 'state', state }
  }
  if (m.type === 'micState' && typeof m.state === 'string' && MIC_STATES.includes(m.state as MicState)) {
    return { type: 'micState', state: m.state as MicState }
  }
  return null
}
