/**
 * reel-highlight — how the tablet camera REEL's cards light up (D483, phase two).
 *
 * The operator reported that the reel does not light up on motion, and asked for
 * a settings button restricted to the highlights with *«di default attivi sia
 * motion che audio»*. The reel consumed no highlight at all — `grep -c
 * highlight` in `CameraShelf.tsx` and `camera-shelf.ts` was 0 in both — so there
 * was no wiring bug to find. This is the missing wiring's pure half.
 *
 * ## Scope: ONE object for the whole reel, not one per camera
 *
 * The operator said *«settings comuni su quella griglia»*, and the surface
 * forces the same answer. The camera-detail PICTURE has a highlight object, but
 * it is per-camera (`useCameraViewOptions(deviceId)`), and the reel draws many
 * cameras — there is no "the" camera whose settings it could borrow. Sharing
 * would also mean that changing the border of the picture silently restyles the
 * reel underneath it.
 *
 * So the reel owns ONE global object, in its own small persisted store
 * (`reel-highlight-store.ts`) — the shape `reel-filter-store.ts` already uses
 * for "what the Recent-events reel shows", at the same scope.
 *
 * Two homes were rejected for structural reasons, not taste:
 *
 *  - **`grid-store`**, because `setGridHighlightEntry` is keyed to a real
 *    persisted grid and is documented as a "no-op for an unknown id" — a reel
 *    entry would be silently dropped, which is the worst kind of storage bug.
 *  - **`settings-store`**, beside `settings.cameraList`, which is otherwise
 *    exactly the right neighbour (what one surface draws over its thumbnails,
 *    global). It cannot go there: `grid-store` imports `settings-store`, so
 *    pulling `GridHighlightSettings` into `settings-store` would close an
 *    import cycle.
 *
 * ## The type is `GridHighlightSettings`, reused whole
 *
 * So that `HighlightTriggerRows` — the editor already shared by the
 * camera-detail overlay panel, the grid menu and the grid share dialog — is
 * mounted VERBATIM. `clusterLabel` rides along unused here: it styles timeline
 * cluster cards and the reel has no timeline. Carrying one inert field is
 * cheaper than a fourth highlight editor, which is what a reel-specific type
 * would have required.
 */
import { dbfsForAudioUi, type AudioHighlightUi } from '../components/camera/audio-level.js'
import {
  GRID_HIGHLIGHT_DEFAULTS,
  type GridHighlightSettings,
} from './grid-store.js'

/**
 * The audio sensitivity the reel starts at.
 *
 * ## Why `mid`, and why this is the operator's to overrule
 *
 * "Audio on" is not a boolean: the stored field is a MODE (`off | sensor |
 * level`) plus a dBFS threshold, and the three named sensitivities the editor
 * offers are meter rungs 2 / 4 / 6 → **-53 / -39 / -24 dBFS**
 * (`AUDIO_LEVEL_THRESHOLDS_DBFS`). So a default is a choice of rung.
 *
 * `audio-level.ts` carries the calibration, measured against the hub's true
 * dBFS RMS: indoor audio is quiet at ≈ -55…-42, conversation at ≈ -42…-25, loud
 * at ≥ -24.
 *
 *  - `low` (-53) sits INSIDE the quiet band. It is above the noise floor by
 *    7 dB, so on most cameras it lights on room tone — and on a reel the cost
 *    of over-firing is multiplied by every card on screen, which turns the
 *    feature from information into decoration.
 *  - `mid` (-39) sits just inside the quiet END of the conversation band: room
 *    tone does not reach it, a person talking, a door or a vehicle does.
 *  - `high` (-24) fires only on genuinely loud events — too deaf for a default
 *    the operator asked to have ON.
 *
 * So `mid`. **This was NOT derived from the fleet's own baseline.** The hub
 * measures a per-camera noise baseline (the `audio-dbfs` series in
 * `pipeline-analytics:stats-5m`), which is the honest input for this number,
 * and the session that wrote this was not permitted to query the hub. It is a
 * reasoned default from the shipped calibration, one constant wide, and the
 * operator should overrule it if their cameras say otherwise.
 */
export const REEL_AUDIO_DEFAULT_UI: Exclude<AudioHighlightUi, 'off'> = 'mid'

/**
 * The reel's starting highlight: motion AND audio on, detection off.
 *
 * Spread from `GRID_HIGHLIGHT_DEFAULTS` rather than restated, so a field added
 * to the shared shape reaches the reel too. Only what the operator asked for is
 * overridden — the grid's own default is commented "motion-only, like a sane
 * starting point" and stays exactly that: changing it would re-default every
 * persisted grid in the app.
 *
 * Detection stays OFF. The operator named motion and audio; detection also
 * costs a per-camera detection subscription per card, which is the multiplied
 * cost `CamerasDisplaySheet` already refuses for the camera list. It remains
 * one switch away in the editor.
 */
export const REEL_HIGHLIGHT_DEFAULTS: GridHighlightSettings = Object.freeze({
  ...GRID_HIGHLIGHT_DEFAULTS,
  motion: true,
  audio: 'level',
  audioDb: dbfsForAudioUi(REEL_AUDIO_DEFAULT_UI),
})

/**
 * Which triggers this highlight actually asks for.
 *
 * Used to decide whether a card subscribes at all: a reel of N cards must not
 * open N detection streams for a trigger that is switched off. `audio` is a
 * mode and not a boolean, so "is audio asked for" is a comparison and not a
 * truthiness test — `'off'` is a non-empty string.
 */
export interface ReelHighlightDemand {
  readonly motion: boolean
  readonly audio: boolean
  readonly detection: boolean
  /** True when NOTHING is asked for — no card needs any subscription. */
  readonly idle: boolean
}

export function reelHighlightDemand(highlight: GridHighlightSettings): ReelHighlightDemand {
  const motion = highlight.motion
  const audio = highlight.audio !== 'off'
  const detection = highlight.detection
  return { motion, audio, detection, idle: !motion && !audio && !detection }
}
