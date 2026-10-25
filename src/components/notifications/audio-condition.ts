/**
 * audio-condition — pure, RN-free logic behind the sustained-sound condition
 * widget. Split out of the component for the reason every other `*-editor.ts`
 * in this folder is: what gets STORED is the part worth asserting, and it is
 * asserted directly in the node test env.
 *
 * Four behaviours here are not cosmetic:
 *
 *  1. **dBFS is negative-going.** `0` is full scale; silence reads `-96`. A
 *     control that let an operator author `60` meaning "loud" would write a
 *     threshold no sample can ever reach, and the rule would look broken rather
 *     than mis-configured. Every write is clamped into `[-96, 0]`.
 *  2. **Neither filter given = the engine REFUSES.** With no level floor and no
 *     labels every sample is trivially a hit, so the window would fire on
 *     silence. {@link audioIsFailClosed} is how the editor says that BEFORE the
 *     save instead of shipping a rule that never notifies.
 *  3. **Both label spellings are the same label.** The hub's taxonomy serves
 *     `audio-dog`; the macro catalog and an operator both say `dog`, and the
 *     matcher normalizes the prefix away on both sides. Selection therefore
 *     compares NORMALIZED ids — a rule authored in the admin UI must not read
 *     as "nothing selected" on the phone.
 *  4. **A stored label the app does not know stays visible.** It is offered as
 *     an explicitly-unknown, removable chip, never silently dropped: rewriting
 *     the rule the operator is looking at is worse than showing a stale id.
 */
import {
  NC_AUDIO_DBFS_FLOOR,
  type NcAudioCondition,
  type NcTaxonomy,
} from '../../data/notification-center.js'

/** One audio macro class, mirroring `@camstack/types` `AUDIO_MACRO_LABELS`.
 *  The hub's taxonomy carries the ids and the words but NOT the icons, so the
 *  emoji live here — the ids are what the two sides agree on. */
export interface NcAudioMacroLabel {
  /** Bare macro id, as written to the rule (`dog`, never `audio-dog`). */
  readonly id: string
  readonly icon: string
  /** English fallback; the hub's taxonomy label wins when it serves one. */
  readonly name: string
}

/** The macro vocabulary the picker offers when the hub sends no taxonomy. */
export const NC_AUDIO_MACRO_LABELS: readonly NcAudioMacroLabel[] = [
  { id: 'speech', icon: '🗣️', name: 'Speech' },
  { id: 'scream', icon: '😱', name: 'Scream / Shout' },
  { id: 'crying', icon: '😢', name: 'Crying / Baby' },
  { id: 'laughter', icon: '😂', name: 'Laughter' },
  { id: 'music', icon: '🎵', name: 'Music' },
  { id: 'dog', icon: '🐕', name: 'Dog' },
  { id: 'cat', icon: '🐈', name: 'Cat' },
  { id: 'bird', icon: '🐦', name: 'Bird' },
  { id: 'animal', icon: '🐾', name: 'Animal (other)' },
  { id: 'alarm', icon: '🚨', name: 'Alarm / Siren' },
  { id: 'doorbell', icon: '🔔', name: 'Doorbell / Knock' },
  { id: 'glass_breaking', icon: '💥', name: 'Glass Breaking' },
  { id: 'gunshot', icon: '💣', name: 'Gunshot / Explosion' },
  { id: 'vehicle', icon: '🚗', name: 'Vehicle' },
  { id: 'siren', icon: '🚑', name: 'Emergency Siren' },
  { id: 'fire', icon: '🔥', name: 'Fire / Smoke' },
  { id: 'water', icon: '💧', name: 'Water' },
  { id: 'wind', icon: '🌬️', name: 'Wind / Weather' },
  { id: 'door', icon: '🚪', name: 'Door' },
  { id: 'footsteps', icon: '👣', name: 'Footsteps' },
  { id: 'crowd', icon: '👥', name: 'Crowd / Chatter' },
  { id: 'telephone', icon: '📞', name: 'Telephone' },
  { id: 'engine', icon: '⚙️', name: 'Engine / Motor' },
  { id: 'tools', icon: '🔨', name: 'Tools / Construction' },
  { id: 'silence', icon: '🤫', name: 'Silence' },
]

/** The `audio-` namespace the NC taxonomy uses for these same macro ids. */
const AUDIO_KIND_PREFIX = 'audio-'

/** Strip the taxonomy's `audio-` namespace: `audio-dog` and `dog` are one label. */
export function normalizeAudioLabel(value: string): string {
  return value.startsWith(AUDIO_KIND_PREFIX) ? value.slice(AUDIO_KIND_PREFIX.length) : value
}

// ── Cap bounds and offered defaults ─────────────────────────────────────────

/** Level bounds, in dBFS. Negative-going: the ceiling is full scale. */
export const NC_AUDIO_DB_MIN = NC_AUDIO_DBFS_FLOOR
export const NC_AUDIO_DB_MAX = 0
/** Step of the level control — 3 dB is one perceptual notch, not one unit. */
export const NC_AUDIO_DB_STEP = 3
/**
 * Offered when the operator switches to LEVEL mode. NOT a schema default: an
 * absent `dbThreshold` means "any level" and stays absent until asked for, and
 * a stepper seeded at the −96 floor would need thirty taps to reach a threshold
 * that can actually fire.
 *
 * **It was −30 and −30 is a trap.** dBFS is negative-going, so a HIGHER number
 * is a NARROWER filter, and the sounds this hub is actually asked about are not
 * loud: measured on the live installation, real crying sits between −55 and
 * −26 dBFS. A floor at −30 therefore rejects most of the very sound the
 * operator turned the filter on for, and the rule looks broken rather than
 * mis-seeded. The offered floor is the QUIET end of that measured band; the
 * editor says which way the number runs rather than leaving it to be inferred.
 */
export const NC_AUDIO_DB_OFFERED = -55

export const NC_AUDIO_HIT_PERCENT_MIN = 1
export const NC_AUDIO_HIT_PERCENT_MAX = 100
export const NC_AUDIO_SAMPLING_MIN_SEC = 1
export const NC_AUDIO_SAMPLING_MAX_SEC = 300
export const NC_AUDIO_CONFIRM_HITS_DEFAULT = 2
export const NC_AUDIO_CONFIRM_WINDOW_SEC_DEFAULT = 5
export const NC_AUDIO_CONFIRM_HITS_MIN = 1
export const NC_AUDIO_CONFIRM_HITS_MAX = 20
export const NC_AUDIO_CONFIRM_WINDOW_MIN_SEC = 1
export const NC_AUDIO_CONFIRM_WINDOW_MAX_SEC = 60

/** Schema defaults — an untouched sub-field must author exactly these. */
export const NC_AUDIO_DEFAULTS: NcAudioCondition = { hitPercent: 60, samplingSeconds: 10 }

/** What the widget SHOWS for an unset condition — without authoring it. */
export function audioOrDefaults(value: NcAudioCondition | undefined): NcAudioCondition {
  return value ?? NC_AUDIO_DEFAULTS
}

/**
 * The two EXCLUSIVE ways an audio rule works (server decision D157) — mirrors
 * `@camstack/types` `NcAudioMode`.
 *
 *  - `label` — the rule NAMES SOUNDS. It fires on the FIRST frame the
 *    classifier labels with one of them (above the analyzer's own per-device
 *    confidence floor). No window, no hit percentage: the rule's cooldown is
 *    the only brake. A sparse classifier puts a macro label on one to three
 *    frames per episode, so a percentage of the window was a question it could
 *    never answer — the shipped 60% default made every label rule unable to
 *    fire.
 *  - `level` — the rule NAMES A LEVEL. The sampling window is the whole point:
 *    `hitPercent`% of the samples over `samplingSeconds` must clear
 *    `dbThreshold`.
 */
export type NcAudioMode = 'label' | 'level'

/**
 * Which mode this condition is in — the ONE place that question is answered.
 *
 * The mode is NOT a stored field, deliberately: it is which filter the rule
 * carries, so every rule authored before the modes existed migrates for free
 * and there is no second switch that can disagree with the first. `null` =
 * neither filter, which the engine refuses (see {@link audioIsFailClosed}).
 *
 * A LEGACY rule carrying BOTH resolves to `label`: it is the mode that fires,
 * and the alternative is silently keeping a window the operator can no longer
 * see in the editor. Nothing new can reach this branch — {@link patchAudio}
 * clears the other filter on every write.
 */
export function audioModeOf(value: NcAudioCondition | undefined): NcAudioMode | null {
  if (value === undefined) return null
  if (value.labels !== undefined && value.labels.length > 0) return 'label'
  if (value.dbThreshold !== undefined) return 'level'
  return null
}

/**
 * True when the condition names NEITHER a level floor NOR any label. The engine
 * refuses such a rule (every sample is a hit, so the window fires on silence) —
 * the editor warns instead of letting the operator ship a rule that never
 * notifies and says nothing about why.
 */
export function audioIsFailClosed(value: NcAudioCondition | undefined): boolean {
  if (value === undefined) return false
  return value.dbThreshold === undefined && (value.labels === undefined || value.labels.length === 0)
}

/**
 * A patch over the composite condition. A key present with `undefined` CLEARS
 * the (optional) filter; an absent key leaves it alone.
 *
 * `mode` is the explicit switch the editor's mode picker sends. It is not
 * stored — {@link patchAudio} turns it into which filter survives.
 */
export interface NcAudioPatch {
  readonly mode?: NcAudioMode
  readonly labels?: readonly string[] | undefined
  readonly dbThreshold?: number | undefined
  readonly hitPercent?: number
  readonly samplingSeconds?: number
  readonly confirmHits?: number
  readonly confirmWindowSec?: number
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function has(patch: NcAudioPatch, key: keyof NcAudioPatch): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key)
}

/**
 * Apply a sub-field edit, seeding from the defaults when nothing is stored yet.
 * The result is always in-bounds for `NcAudioConditionSchema`, and a cleared
 * filter is OMITTED rather than written as an explicit `undefined` (which
 * survives a merge patch as a deliberate erase and reads as authored).
 *
 * **The two modes are exclusive here, structurally.** Writing labels drops any
 * stored `dbThreshold`; writing a `dbThreshold` drops the labels. The hub
 * normalizes the same way, but the FORM must not send both regardless: a save
 * that writes a window the editor no longer shows is a knob that disagrees with
 * the authority it describes. A legacy both-filters rule is therefore
 * normalized the first time it is touched, onto the mode {@link audioModeOf}
 * already reads it as.
 *
 * Switching to `level` with nothing stored seeds {@link NC_AUDIO_DB_OFFERED}:
 * a level rule with no floor is fail-closed, and handing the operator a mode
 * that cannot fire is the trap this whole change exists to remove.
 */
export function patchAudio(
  current: NcAudioCondition | undefined,
  patch: NcAudioPatch,
): NcAudioCondition {
  const base = audioOrDefaults(current)
  const wantedLabels = has(patch, 'labels') ? patch.labels : base.labels
  const wantedDb = has(patch, 'dbThreshold') ? patch.dbThreshold : base.dbThreshold
  const hasLabels = wantedLabels !== undefined && wantedLabels.length > 0
  // Which mode this write lands in: the explicit picker first, then the filter
  // the write itself touched, then whatever the stored condition already was.
  const mode: NcAudioMode | null =
    patch.mode ??
    (has(patch, 'labels') && hasLabels
      ? 'label'
      : has(patch, 'dbThreshold') && wantedDb !== undefined
        ? 'level'
        : hasLabels
          ? 'label'
          : wantedDb !== undefined
            ? 'level'
            : null)
  const labels = mode === 'label' && hasLabels ? wantedLabels : undefined
  const dbThreshold =
    mode !== 'level'
      ? undefined
      : (wantedDb ?? (patch.mode === 'level' ? NC_AUDIO_DB_OFFERED : undefined))
  return {
    ...(labels !== undefined ? { labels: [...labels] } : {}),
    ...(dbThreshold !== undefined
      ? { dbThreshold: clampInt(dbThreshold, NC_AUDIO_DB_MIN, NC_AUDIO_DB_MAX) }
      : {}),
    hitPercent: clampInt(
      patch.hitPercent ?? base.hitPercent,
      NC_AUDIO_HIT_PERCENT_MIN,
      NC_AUDIO_HIT_PERCENT_MAX,
    ),
    samplingSeconds: clampInt(
      patch.samplingSeconds ?? base.samplingSeconds,
      NC_AUDIO_SAMPLING_MIN_SEC,
      NC_AUDIO_SAMPLING_MAX_SEC,
    ),
    ...((): { confirmHits?: number; confirmWindowSec?: number } => {
      const hits = has(patch, 'confirmHits') ? patch.confirmHits : base.confirmHits
      const windowSec = has(patch, 'confirmWindowSec')
        ? patch.confirmWindowSec
        : base.confirmWindowSec
      return {
        ...(hits !== undefined
          ? {
              confirmHits: clampInt(hits, NC_AUDIO_CONFIRM_HITS_MIN, NC_AUDIO_CONFIRM_HITS_MAX),
            }
          : {}),
        ...(windowSec !== undefined
          ? {
              confirmWindowSec: clampInt(
                windowSec,
                NC_AUDIO_CONFIRM_WINDOW_MIN_SEC,
                NC_AUDIO_CONFIRM_WINDOW_MAX_SEC,
              ),
            }
          : {}),
      }
    })(),
  }
}

/** One offered label. `unknown` = stored by the rule, not offered by the hub or
 *  the local catalog — kept so the operator can SEE it and drop it. */
export interface NcAudioLabelChoice {
  readonly value: string
  readonly label: string
  readonly icon: string
  readonly unknown: boolean
}

/** The icon glyph for a stored label the catalogue does not know. */
const UNKNOWN_LABEL_ICON = '🔈'

const ICON_BY_ID = new Map(NC_AUDIO_MACRO_LABELS.map((macro) => [macro.id, macro.icon]))

/**
 * The label choices: the hub's `audioKinds` when it serves them (its WORDS, the
 * local EMOJI, keyed by the normalized id), else the local macro catalog — plus
 * any stored label neither side knows, marked unknown.
 *
 * The hub's list wins on membership because it knows which macros this cluster
 * actually classifies; the icons stay local because the taxonomy carries none.
 */
export function audioLabelChoices(
  taxonomy: NcTaxonomy | undefined,
  selected: readonly string[] | undefined,
): {
  readonly choices: readonly NcAudioLabelChoice[]
  readonly unknownLabels: readonly string[]
} {
  const fromHub = taxonomy?.audioKinds ?? []
  const choices: NcAudioLabelChoice[] =
    fromHub.length > 0
      ? fromHub.map((entry) => {
          const id = normalizeAudioLabel(entry.kind)
          const icon = ICON_BY_ID.get(id) ?? UNKNOWN_LABEL_ICON
          return { value: id, label: entry.label, icon, unknown: false }
        })
      : NC_AUDIO_MACRO_LABELS.map((macro) => ({
          value: macro.id,
          label: macro.name,
          icon: macro.icon,
          unknown: false,
        }))

  const known = new Set(choices.map((choice) => choice.value))
  const unknownLabels: string[] = []
  for (const stored of selected ?? []) {
    const id = normalizeAudioLabel(stored)
    if (known.has(id) || unknownLabels.includes(id)) continue
    unknownLabels.push(id)
    choices.push({ value: id, label: id, icon: UNKNOWN_LABEL_ICON, unknown: true })
  }
  return { choices, unknownLabels }
}

/** Is this macro id selected? Compares NORMALIZED ids, so a rule authored with
 *  the taxonomy spelling (`audio-dog`) reads as selected here. */
export function isAudioLabelSelected(
  labels: readonly string[] | undefined,
  id: string,
): boolean {
  const wanted = normalizeAudioLabel(id)
  return (labels ?? []).some((stored) => normalizeAudioLabel(stored) === wanted)
}

/**
 * Toggle one macro id. Removing drops EVERY stored spelling of it; adding
 * appends the bare macro id. Returns `undefined` when the last label goes —
 * the field is optional and absent means "any sound", never an empty array
 * (which `NcAudioConditionSchema` rejects outright).
 */
export function toggleAudioLabel(
  labels: readonly string[] | undefined,
  id: string,
): readonly string[] | undefined {
  const wanted = normalizeAudioLabel(id)
  const current = labels ?? []
  if (isAudioLabelSelected(current, wanted)) {
    const next = current.filter((stored) => normalizeAudioLabel(stored) !== wanted)
    return next.length > 0 ? next : undefined
  }
  return [...current, wanted]
}
