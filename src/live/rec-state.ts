/**
 * rec-state — the ONE translation of the embed's `recState` string into the
 * app's {@link PlaybackMode}.
 *
 * Each host used to carry its own copy of this switch, and the web one said so
 * in its comment: *"Mirrors the iOS `mapRecState` 1:1"*. A hand-copy is a
 * second opinion that has not drifted YET — and both copies were wrong in the
 * same place, which is the other thing duplicated switches are good at.
 *
 * ## `ended` is a state, not a failure
 *
 * The broker's clip feeder emits `state: 'ended'` when a file plays out
 * (`clip-stream-feeder.ts`, `emitState('ended', 'stream-played-out')`) and the
 * recorded feeder does the same at the end of our own footage
 * (`advance-ended`). Neither copy of the switch listed it, so it fell to the
 * `default:` arm — `'error'`. A clip that finished normally therefore rang the
 * playback bar's danger ring and, in a recorded session, moved the machine
 * into `error` (`adoptEmbedState`): a fault notice for a file that did exactly
 * what it was asked to.
 *
 * It also meant the app had NO end-of-clip fact. The loop switch is decided
 * from this one report (`clips/clip-loop.ts`).
 *
 * Unknown values still collapse to `'error'`: a state a newer embed invented
 * is not one this build can act on, and mapping it to `playing` would be a
 * claim about a picture nobody has looked at.
 *
 * Pure: no React, no DOM, no network.
 */

import type { PlaybackMode } from '../recording/playback-status.js'

const KNOWN: readonly PlaybackMode[] = [
  'live',
  'loading',
  'playing',
  'paused',
  'gap',
  'ended',
  'error',
]

/** A guard rather than a cast: the wire's string is narrowed, never asserted. */
function isPlaybackMode(value: string): value is PlaybackMode {
  return KNOWN.some((known) => known === value)
}

export function mapRecState(state: string): PlaybackMode {
  return isPlaybackMode(state) ? state : 'error'
}
