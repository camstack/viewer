/**
 * What the compact media-player control shows, derived from the status and the
 * device's declared features — never from a vendor. Pure, so it can be pinned
 * without rendering.
 *
 * Two honesty rules, from the infrared TV (a media-player backed by the
 * `remote` extension, no feedback):
 *  - an unknown state is `unknown`, never idle, and never "off";
 *  - a volume with steps and no level is two buttons, never a slider with a
 *    made-up position, and an unknown level is not drawn as 0.
 */
import type { MediaPlayerState, MediaPlayerStatus } from '../../../data/use-accessory-controls-ext.js'

export type PowerView = 'on' | 'off' | 'standby' | 'unknown'
export type VolumeView = 'steps' | 'none'

export interface MediaPlayerFeatureFlags {
  readonly power: boolean
  readonly volumeLevel: boolean
  readonly volumeStep: boolean
}

/** The wire carries kebab-case feature names (`DeviceFeature` values). */
export function mediaPlayerFeatureFlags(features: readonly string[] | undefined): MediaPlayerFeatureFlags {
  const has = (name: string): boolean => features?.includes(name) ?? false
  return {
    power: has('media-player-power'),
    volumeLevel: has('media-player-volume'),
    volumeStep: has('media-player-volume-step'),
  }
}

export function powerOf(state: MediaPlayerState | undefined): PowerView {
  if (state === undefined) return 'unknown'
  if (state === 'off') return 'off'
  if (state === 'standby') return 'standby'
  return 'on'
}

/** The central transport key means "pause" only while something plays. */
export function isPlaying(state: MediaPlayerState | undefined): boolean {
  return state === 'playing' || state === 'buffering'
}

/** Step buttons for a player that declares steps and no level; a level slider is not drawn in the row. */
export function volumeViewOf(flags: MediaPlayerFeatureFlags): VolumeView {
  return flags.volumeStep && !flags.volumeLevel ? 'steps' : 'none'
}

/** The command a power press sends: on while the player is off or in standby, off while on. */
export function powerCommandFor(power: PowerView): 'turnOn' | 'turnOff' | null {
  if (power === 'on') return 'turnOff'
  if (power === 'off' || power === 'standby') return 'turnOn'
  return null
}

/** The volume level as text, or `null` when the device reported none (never "0%"). */
export function volumeLevelText(status: MediaPlayerStatus | null | undefined): string | null {
  const level = status?.volumeLevel
  return level === null || level === undefined ? null : `${Math.round(level)}%`
}

/** The programme / media title to show, or `null` — an empty row is never drawn. */
export function titleText(status: MediaPlayerStatus | null | undefined): string | null {
  return status?.title ?? null
}
