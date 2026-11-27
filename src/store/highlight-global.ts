/**
 * highlight-global — the highlight border's ONE global document (planning#751).
 *
 * The border's triggers used to be stored per camera (`camera-prefs`) and per
 * grid (`grid-store`), so the same wall lit differently depending on where you
 * opened it. They are now `AppSettings.highlight`, one for everything. This
 * module holds the pure pieces:
 *
 *   • `resolveHighlight` / `highlightPatch` — the document seen as the shared
 *     `GridHighlightSettings` shape every renderer and editor already speaks
 *     (detection is ON exactly when a label is selected),
 *   • `foldLegacyHighlight` — the ONE-TIME move of the old per-camera values
 *     into the global document, stamped by `highlight.rev` so a second run
 *     (and a later edit) never overwrites.
 *
 * Pure — no React, no storage. The storage read lives in
 * `highlight-migration.ts`.
 */
import { MACRO_LABELS } from '@camstack/types/client'
import type { GridHighlightSettings } from './grid-store.js'
import type { HighlightAppearance } from './settings-store.js'

/** The stamp a folded document carries. */
export const HIGHLIGHT_REV = 1

/** Classes the detection highlight can be restricted to: the detector's macro
 *  classes plus the two detail classes the viewer also draws. */
export const HIGHLIGHT_DETECTION_CLASSES: readonly string[] = [
  ...MACRO_LABELS.map((l) => l.id),
  'face',
  'plate',
]

/** The global document as the shared highlight shape. */
export function resolveHighlight(h: HighlightAppearance): GridHighlightSettings {
  return {
    motion: h.motion,
    audio: h.audio,
    audioDb: h.audioDb,
    audioHoldSec: h.audioHoldSec,
    detection: h.detectionClasses.length > 0,
    detectionHoldSec: h.detectionHoldSec,
    detectionClasses: h.detectionClasses,
    clusterLabel: h.clusterLabel,
  }
}

/** A highlight edit (the shared shape) as a patch of the global document.
 *  `detection` has no field of its own: on selects every class (when none was
 *  picked), off clears the selection. */
export function highlightPatch(
  current: HighlightAppearance,
  patch: Partial<GridHighlightSettings>,
): Partial<HighlightAppearance> {
  const out: { -readonly [K in keyof HighlightAppearance]?: HighlightAppearance[K] } = {}
  if (patch.motion !== undefined) out.motion = patch.motion
  if (patch.audio !== undefined) out.audio = patch.audio
  if (patch.audioDb !== undefined) out.audioDb = patch.audioDb
  if (patch.audioHoldSec !== undefined) out.audioHoldSec = patch.audioHoldSec
  if (patch.detectionHoldSec !== undefined) out.detectionHoldSec = patch.detectionHoldSec
  if (patch.clusterLabel !== undefined) out.clusterLabel = patch.clusterLabel
  if (patch.detectionClasses !== undefined) {
    out.detectionClasses = patch.detectionClasses
  } else if (patch.detection === true && current.detectionClasses.length === 0) {
    out.detectionClasses = HIGHLIGHT_DETECTION_CLASSES
  }
  if (patch.detection === false) out.detectionClasses = []
  return out
}

/** What a camera stored before the document went global (any field may be
 *  missing in an old blob). */
export type LegacyHighlight = Partial<GridHighlightSettings>

function sameLegacy(a: LegacyHighlight, b: LegacyHighlight): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** The most common stored highlight across cameras (first wins a tie) — the
 *  same adoption rule the overlay document used when it went global. */
export function mostCommonLegacy(all: readonly LegacyHighlight[]): LegacyHighlight | null {
  let best: { value: LegacyHighlight; n: number } | null = null
  const seen: { value: LegacyHighlight; n: number }[] = []
  for (const value of all) {
    const hit = seen.find((e) => sameLegacy(e.value, value))
    if (hit) hit.n += 1
    else seen.push({ value, n: 1 })
  }
  for (const entry of seen) if (best === null || entry.n > best.n) best = entry
  return best?.value ?? null
}

/**
 * Fold the old per-camera values into the global document — ONCE. A document
 * already stamped is returned as the same object, untouched. `masterOff` is the
 * old overlay master switch: a border that was off everywhere starts all-off.
 */
export function foldLegacyHighlight(
  current: HighlightAppearance,
  legacy: readonly LegacyHighlight[],
  masterOff: boolean,
): HighlightAppearance {
  if (current.rev >= HIGHLIGHT_REV) return current
  const picked = mostCommonLegacy(legacy)
  const next: { -readonly [K in keyof HighlightAppearance]: HighlightAppearance[K] } = {
    ...current,
    rev: HIGHLIGHT_REV,
  }
  if (picked !== null) {
    if (picked.motion !== undefined) next.motion = picked.motion
    if (picked.audio !== undefined) next.audio = picked.audio
    if (picked.audioDb !== undefined) next.audioDb = picked.audioDb
    if (picked.audioHoldSec !== undefined) next.audioHoldSec = picked.audioHoldSec
    if (picked.detectionHoldSec !== undefined) next.detectionHoldSec = picked.detectionHoldSec
    if (picked.clusterLabel !== undefined) next.clusterLabel = picked.clusterLabel
    const classes = picked.detectionClasses ?? []
    // "Detection on, no class picked" meant ANY class: the selection says it.
    next.detectionClasses = picked.detection === true ? (classes.length > 0 ? classes : HIGHLIGHT_DETECTION_CLASSES) : []
  }
  if (masterOff) {
    next.motion = false
    next.audio = 'off'
    next.detectionClasses = []
  }
  return next
}
