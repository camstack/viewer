/**
 * tile-model — what a gallery tile SAYS about a track, decided once and pure.
 *
 * The chips drawn over the picture, the details block under it and the
 * accessibility label are all derived here from the same shared row logic the
 * embed's card uses (`resolveRowTitle`, `iconIdForClass`, `isAudioSourceRow`),
 * so the two surfaces cannot disagree about what a track is called.
 *
 * A text chip says only what the glyph does not: the recognised identity, a
 * sub-class finer than the stored class, a synthetic sensor's type. A track
 * whose best name is its own class is the GLYPH alone (the Photos-grid
 * density), unless the operator chose text for the class (`tileLabelStyle`).
 */
import {
  iconIdForClass,
  kindLabelFor,
} from '../../../../shared/events/events-taxonomy.js'
import {
  isAudioSourceRow,
  resolveRowTitle,
  type EventsTrackRow,
} from '../../../../shared/events/events-track-row.js'
import type { TileLabelMode } from '../../../store/settings-store.js'
import { formatEventTime } from '../../../../shared/events/events-time.js'

export interface TileChipOptions {
  readonly labelMode: TileLabelMode
  /** D / T pills. The favourite star and the active dot are for everyone. */
  readonly showAdminFlags: boolean
  readonly kindLabels: ReadonlyMap<string, string>
  readonly iconIds: ReadonlyMap<string, string>
  /** The viewer's date locale — the clock chip is formatted with it. */
  readonly locale: string
  /** The page's "now" — a track from another day carries its day shortcut (`DD/MM HH:MM`). */
  readonly nowMs: number
}

export interface TileChips {
  /** The taxonomy glyph id for the class (or the audio macro). */
  readonly glyphId: string
  /** The text chip, or null when the glyph already says it. */
  readonly text: string | null
  /** A face was captured and nobody has named it — the "?" chip. */
  readonly unassignedFace: boolean
  readonly active: boolean
  readonly favourited: boolean
  readonly debug: boolean
  readonly train: boolean
  readonly trained: boolean
  /** `HH:MM` of the last sighting, `DD/MM HH:MM` on another day — what the corner chip says (as the embed card does). */
  readonly time: string
}

export function tileChips(row: EventsTrackRow, options: TileChipOptions): TileChips {
  const title = resolveRowTitle(row, options.kindLabels)
  const audio = isAudioSourceRow(row)
  const text = options.labelMode === 'label' ? title.text : null
  return {
    glyphId: iconIdForClass(row.className, options.iconIds, audio),
    text,
    unassignedFace: row.hasUnassignedFace === true,
    active: row.active,
    favourited: row.favourited === true,
    debug: options.showAdminFlags && row.debug === true,
    train: options.showAdminFlags && row.markForTrain === true,
    trained: options.showAdminFlags && row.retrainStatus === 'trained',
    time: formatEventTime(row.lastSeen, options.nowMs, options.locale),
  }
}

/** The first zone NAME the track visited, or null (ids are never shown). */
export function tileZone(row: EventsTrackRow): string | null {
  const name = row.zoneNames[0]
  return name !== undefined && name.length > 0 ? name : null
}

/** One spoken line for the whole tile — the label a screen reader gets. */
export function tileAccessibilityLabel(
  row: EventsTrackRow,
  kindLabels: ReadonlyMap<string, string>,
  time: string,
): string {
  const title = resolveRowTitle(row, kindLabels).text || kindLabelFor(row.className, kindLabels)
  return `${title}, ${row.cameraName}, ${time}`
}
