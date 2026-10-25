/**
 * use-reel-highlight — "is THIS reel card lit right now", from the signals every
 * other surface already keys off (D483 phase two).
 *
 * ## Why a hook and not the detail screen's expression
 *
 * `CameraDetailScreen` composes the same three triggers inline, and it is
 * tempting to call this a duplication of it. It is not the same question.
 * That screen needs the three flags SEPARATELY — motion, audio and detection
 * drive different overlays, each in its own colour — plus two concerns a reel
 * card does not have: the WebView player computes its own highlight so the
 * native subscriptions are skipped there, and picking an audio rung lights the
 * border for 5 s as a preview.
 *
 * A card needs ONE boolean. So this is thin glue over the SAME primitives —
 * `useMotionHighlight`, `useAudioActive` + `useHeld`, `useDetections` + `useHeld`
 * — in the same order, with the same holds. Nothing about the signals is
 * reimplemented; `useMotionHighlight`'s own docblock already calls itself "the
 * single source every surface keys its motion indicator off", and this keeps it
 * that way.
 *
 * (A follow-up worth doing and deliberately not done here: lifting the detail
 * screen's three-flag composition onto a shared hook that returns the flags
 * separately, with this as its one-boolean reduction. That is a refactor of a
 * 2 600-line screen and does not belong in the change that adds the reel's
 * wiring.)
 *
 * ## Cost, which is the whole reason `enabled` exists
 *
 * The reel is N cards. Every trigger a card subscribes to is a live-event
 * subscription per camera, so a switched-off trigger must open NOTHING —
 * `reelHighlightDemand` answers that per trigger and each hook is gated on its
 * own answer. `CamerasDisplaySheet` already refuses per-frame overlays on the
 * camera list for exactly this multiplication.
 */
import { useDetections } from './use-detections.js'
import { useMotionHighlight } from './use-motion.js'
import { useAudioActive } from './use-audio.js'
import { useHeld } from './use-held.js'
import { AUDIO_HIGHLIGHT_HOLD_SEC } from '../components/camera/audio-level.js'
import { reelHighlightDemand } from '../store/reel-highlight.js'
import type { GridHighlightSettings } from '../store/grid-store.js'

/**
 * WHICH trigger is lit, not merely whether one is.
 *
 * A card draws ONE ring, and the app already keeps a colour per trigger
 * (`settings.highlight.motionColor` / `.audioColor` / `.detectionColor` — the
 * same three the detail border and the grid tile draw with). A boolean would
 * force every ring to one colour, so a card lit by AUDIO would glow in the
 * motion colour and tell the operator something false. Returning the trigger
 * keeps the reel in the same visual vocabulary as every other surface.
 */
export type ReelHighlightTrigger = 'motion' | 'audio' | 'detection'

/**
 * The lit trigger for `deviceId`, or `null`.
 *
 * Precedence when more than one is lit — **detection, then motion, then
 * audio** — ordered by how much each one TELLS you. A detection names what it
 * saw; motion says only that something moved; audio is the weakest of the three
 * and the easiest to trip. A ring can only be one colour, so the most
 * informative live trigger wins it.
 *
 * @param enabled the SURFACE's gate — is anybody looking at this reel. Combined
 *   with the per-trigger demand, so a card on a reel nobody can see opens no
 *   subscriptions even with every trigger switched on.
 */
export function useReelHighlightTrigger(
  deviceId: number,
  highlight: GridHighlightSettings,
  enabled: boolean,
): ReelHighlightTrigger | null {
  const demand = reelHighlightDemand(highlight)

  const motionActive = useMotionHighlight(deviceId, enabled && demand.motion)

  // `useAudioActive` takes the MODE, and is a no-op at `'off'` — passing
  // `'off'` when the surface is disabled is how this stays one hook call
  // (hooks cannot be conditional) while still subscribing to nothing.
  const audioRaw = useAudioActive(
    deviceId,
    enabled && demand.audio ? highlight.audio : 'off',
    highlight.audioDb,
  )
  const audioActive = useHeld(
    enabled && demand.audio && audioRaw,
    AUDIO_HIGHLIGHT_HOLD_SEC * 1000,
  )

  const detState = useDetections(deviceId, enabled && demand.detection)
  // EMPTY `detectionClasses` means "any class" — the shared convention
  // (`GridHighlightSettings.detectionClasses`), and the same test the detail
  // screen applies. A `.length === 0` read as "match nothing" would make the
  // default selection silently inert.
  const detMatch =
    enabled &&
    demand.detection &&
    detState.boxes.some(
      (b) =>
        highlight.detectionClasses.length === 0 ||
        highlight.detectionClasses.includes(b.label),
    )
  const detActive = useHeld(detMatch, highlight.detectionHoldSec * 1000)

  if (detActive) return 'detection'
  if (motionActive) return 'motion'
  if (audioActive) return 'audio'
  return null
}
