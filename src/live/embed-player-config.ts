/**
 * Shared single-camera embed config — the payload the player embed reads as
 * `window.__CAMSTACK_EMBED__`. The shape MUST match the server's
 * `embedConfigSchema`. Pure. Used by `LiveViewWebView.tsx` (native) and
 * `LiveView.web.tsx` (web).
 */
import type { WebrtcTarget } from './signaling-types.js'
import type { GridHighlightEmbedConfig } from '../grid-embed/embed-config.js'

export interface EmbedConfig {
  readonly serverUrl: string
  readonly token: string
  readonly deviceId: number
  readonly target: WebrtcTarget
  readonly muted: boolean
  readonly stats: boolean
  readonly highlight?: GridHighlightEmbedConfig
  readonly snapshot?: string
  /** Deep-link "go to this moment" (`?at=` → epoch ms): the embed enters
   *  recorded playback at this instant on its own, the moment its control
   *  channel opens — no host round-trip. Omitted ⇒ the player opens live. */
  readonly initialSeekMs?: number
  /** The clip the page opens on — see `LiveViewProps.initialClip`. */
  readonly initialClipId?: string
  readonly initialClipProvider?: string
  readonly initialClipProfile?: string
}

export type BuildPlayerEmbedConfigInput = EmbedConfig

export function buildPlayerEmbedConfig(input: BuildPlayerEmbedConfigInput): EmbedConfig {
  return {
    serverUrl: input.serverUrl,
    token: input.token,
    deviceId: input.deviceId,
    target: input.target,
    muted: input.muted,
    stats: input.stats,
    ...(input.highlight ? { highlight: input.highlight } : {}),
    ...(input.snapshot ? { snapshot: input.snapshot } : {}),
    ...(input.initialSeekMs !== undefined ? { initialSeekMs: input.initialSeekMs } : {}),
  }
}
