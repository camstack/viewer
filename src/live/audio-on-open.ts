/**
 * audio-on-open — what a camera's sound does the instant it opens.
 *
 * The setting used to be a boolean ("unmute audio when opening"), which forced
 * one answer onto every camera: either the doorbell and the nursery both speak
 * the moment you glance at them, or neither ever does and you tap mute-off
 * every single time on the two cameras you actually listen to. The operator
 * asked for the third answer — «com'era l'ultima volta» — so the setting is a
 * MODE, not a flag:
 *
 *   • `on`            — always opens speaking.
 *   • `off`           — always opens silent.
 *   • `last-selected` — opens the way THIS camera was left (the default).
 *
 * Only the mode is global. The per-camera memory it reads is written where the
 * viewer already keeps a per-camera "as you left it" value — `camera-local`,
 * next to `quality` — so there is no second persistence mechanism and no second
 * hydration to wait for. The MODE is an account setting; the memory is a
 * device one.
 *
 * Pure and dependency-free on purpose: the resolution is the whole feature, and
 * it is unit-tested without a renderer (`__tests__/audio-on-open.spec.ts`).
 */

/** How a camera's audio starts. Persisted verbatim in `settings.stream`. */
export type AudioOnOpenMode = 'on' | 'off' | 'last-selected'

/**
 * The offer, in the order the picker lists it: the two absolutes first, then
 * the one that defers to the camera. Exported so the settings UI derives its
 * options from the vocabulary rather than re-spelling it.
 */
export const AUDIO_ON_OPEN_MODES: readonly AudioOnOpenMode[] = ['last-selected', 'on', 'off']

/** The default for an install that has never expressed a preference. */
export const AUDIO_ON_OPEN_DEFAULT: AudioOnOpenMode = 'last-selected'

/** Narrow an unknown persisted value to a mode the app still offers. */
export function isAudioOnOpenMode(raw: unknown): raw is AudioOnOpenMode {
  return raw === 'on' || raw === 'off' || raw === 'last-selected'
}

/**
 * Read `settings.stream.audioOnOpen` out of a persisted document, including one
 * written before the mode existed.
 *
 * MIGRATION. The field held a boolean, and it is honoured EXACTLY — an operator
 * who turned audio on keeps a camera that speaks, one who turned it off keeps
 * silence. Neither is moved onto the new default: `last-selected` is what a
 * fresh install gets, not a re-decision imposed on someone who already
 * answered. Mapping `true` onto `last-selected` would in particular go quiet on
 * a user who had asked for sound, and mapping `false` onto it would be the
 * unacceptable direction — audio nobody asked for.
 *
 * Anything else (absent, junk, a mode a later build offered and this one does
 * not) reads as the default, the same discipline every other field in the
 * settings document follows.
 */
export function parseAudioOnOpen(raw: unknown): AudioOnOpenMode {
  if (isAudioOnOpenMode(raw)) return raw
  // The legacy boolean. `true` was the shipped default from 2026-09-13, so most
  // existing documents carry it whether or not the operator ever touched the
  // switch — honouring it changes nothing for them, which is the point.
  if (raw === true) return 'on'
  if (raw === false) return 'off'
  return AUDIO_ON_OPEN_DEFAULT
}

/**
 * Does this camera open MUTED?
 *
 * `lastChoice` is the camera's remembered choice — `true` = the operator left
 * it with sound, `false` = they left it silent, `undefined` = they have never
 * chosen on this camera. The three states are distinct and must stay so: a
 * camera deliberately left silent and a camera never listened to are the same
 * outcome here, but only one of them is a decision, and collapsing them would
 * make a future change to the fallback silently rewrite the operator's answer.
 *
 * FALLBACK when there is no history: MUTED. Unexpected sound is worse than
 * unexpected silence and not symmetrically so — silence costs one tap on a
 * button that is already on screen, whereas audio that starts on its own plays
 * a room out loud before anyone can stop it, in whatever room the phone happens
 * to be in. It is also the direction that cannot surprise: the very first open
 * of a camera is exactly when the operator has no idea what it is about to do.
 */
export function opensMuted(mode: AudioOnOpenMode, lastChoice: boolean | undefined): boolean {
  if (mode === 'on') return false
  if (mode === 'off') return true
  return lastChoice === undefined ? true : !lastChoice
}
