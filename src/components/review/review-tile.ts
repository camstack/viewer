/**
 * The review tile's rules (People, Plates) — pure, so the piece selection is
 * tested without a renderer. `ReviewTile.tsx` draws what these decide.
 *
 * ONE tile for both pages (operator, 2026-10-23): the same pieces in the same
 * places, configured per page —
 *
 *   • the picture, in the page's shape (`square` faces, `frame` 16:9 plates);
 *   • the capture TIME as the events tile's corner chip (top-right), and the
 *     CAMERA on the image's bottom edge — the People placement, now Plates' too;
 *     each one shown or hidden from the page's display menu (the eye);
 *   • the confidence bar on the image's bottom edge, when the page has a score;
 *   • under the image: the title (a name, a plate), its badge, and Confirm.
 *
 * Default display: the time only (the camera is opt-in, as on Events).
 */
import type { FaceReviewRow, FaceSuggestionCertainty } from '../../data/face-cluster-review.js'
import { faceSuggestionCertainty } from '../../data/face-cluster-review.js'
import type { PlateReviewRow } from '../../data/plate-review.js'
import type { ReviewPagePreferences } from '../../store/settings-store.js'
import type { LibraryTileShape } from '../ui/library-grid.js'

// ── Display: what the operator picked in the eye ──────────────────────────────

/** A detail the operator can switch on a review tile. */
export type ReviewTileDetail = 'date' | 'camera'

export interface ReviewTileDisplay {
  readonly showDate: boolean
  readonly showCamera: boolean
}

export const DEFAULT_REVIEW_TILE_DISPLAY: ReviewTileDisplay = { showDate: true, showCamera: false }

/** The review pages, each with its own display choice. */
export type ReviewPage = 'faces' | 'plates'

type ReviewPrefKey = keyof ReviewPagePreferences

const PREF_KEYS: Readonly<Record<ReviewPage, Readonly<Record<ReviewTileDetail, ReviewPrefKey>>>> = {
  faces: { date: 'facesShowDate', camera: 'facesShowCamera' },
  plates: { date: 'platesShowDate', camera: 'platesShowCamera' },
}

/** The eye's switch for one detail: that detail set, the other kept. */
export function setReviewTileDetail(display: ReviewTileDisplay, detail: ReviewTileDetail, on: boolean): ReviewTileDisplay {
  return detail === 'date'
    ? { showDate: on, showCamera: display.showCamera }
    : { showDate: display.showDate, showCamera: on }
}

/** One page's display, read from the settings document. */
export function reviewTileDisplayFor(page: ReviewPage, prefs: ReviewPagePreferences): ReviewTileDisplay {
  const keys = PREF_KEYS[page]
  return { showDate: prefs[keys.date], showCamera: prefs[keys.camera] }
}

export interface ReviewDisplayWrite {
  readonly key: ReviewPrefKey
  readonly value: boolean
}

/** The settings writes that take `page` from `prev` to `next` — only what changed. */
export function reviewDisplayWrites(
  page: ReviewPage,
  prev: ReviewTileDisplay,
  next: ReviewTileDisplay,
): readonly ReviewDisplayWrite[] {
  const keys = PREF_KEYS[page]
  const writes: ReviewDisplayWrite[] = []
  if (prev.showDate !== next.showDate) writes.push({ key: keys.date, value: next.showDate })
  if (prev.showCamera !== next.showCamera) writes.push({ key: keys.camera, value: next.showCamera })
  return writes
}

// ── Content: what one row says ────────────────────────────────────────────────

/** The badge after the title: a certainty word (a suggested face) or a name (a plate's vehicle). */
export type ReviewTileBadge =
  | { readonly kind: 'certainty'; readonly certainty: FaceSuggestionCertainty }
  | { readonly kind: 'label'; readonly label: string; readonly settled: boolean }

export interface ReviewTileConfidence {
  readonly score: number
  readonly certainty: FaceSuggestionCertainty
}

/** Everything a tile says about its row — plain data, so a memo can compare it. */
export interface ReviewTileContent {
  readonly id: string
  readonly shape: LibraryTileShape
  /** `two`: the title alone on its row, the badge and Confirm under it. */
  readonly rows: 'one' | 'two'
  readonly title: string
  readonly titleMuted: boolean
  readonly titleMono: boolean
  readonly badge: ReviewTileBadge | undefined
  readonly confidence: ReviewTileConfidence | undefined
  /** A one-tap Confirm of the suggestion as shown. */
  readonly confirm: boolean
  /** Assigned: the check on the image corner. */
  readonly settled: boolean
  readonly timestamp: number
  readonly camera: string
}

function cameraLabelOf(row: { readonly cameraName: string | undefined; readonly deviceId: number }): string {
  return row.cameraName ?? `#${String(row.deviceId)}`
}

/** A face: square, the name on its own row; a suggestion carries its certainty and Confirm. */
export function faceReviewTileContent(row: FaceReviewRow, unassignedLabel: string): ReviewTileContent {
  const camera = cameraLabelOf(row)
  const title =
    row.status === 'assigned'
      ? (row.assignedIdentityName ?? camera)
      : row.status === 'suggested'
        ? (row.suggestedIdentityName ?? camera)
        : unassignedLabel
  return {
    id: row.faceId,
    shape: 'square',
    rows: 'two',
    title,
    titleMuted: row.status !== 'suggested',
    titleMono: false,
    badge:
      row.status === 'suggested' && row.certainty !== undefined
        ? { kind: 'certainty', certainty: row.certainty }
        : undefined,
    confidence:
      row.certainty !== undefined && row.suggestedMatchScore !== undefined
        ? { score: row.suggestedMatchScore, certainty: row.certainty }
        : undefined,
    confirm: row.status === 'suggested',
    settled: row.status === 'assigned',
    timestamp: row.timestamp,
    camera,
  }
}

/** A plate: a 16:9 frame, the OCR text as a monospaced title, the vehicle as its badge. */
export function plateReviewTileContent(row: PlateReviewRow): ReviewTileContent {
  const vehicle = row.status !== 'unassigned' ? row.vehicleName : undefined
  return {
    id: row.plateId,
    shape: 'frame',
    rows: 'one',
    title: row.text.length > 0 ? row.text : '—',
    titleMuted: false,
    titleMono: true,
    badge: vehicle !== undefined ? { kind: 'label', label: vehicle, settled: row.status === 'assigned' } : undefined,
    confidence: { score: row.score, certainty: faceSuggestionCertainty(row.score) },
    confirm: row.status === 'suggested',
    settled: row.status === 'assigned',
    timestamp: row.timestamp,
    camera: cameraLabelOf(row),
  }
}

function sameBadge(a: ReviewTileBadge | undefined, b: ReviewTileBadge | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a.kind === 'certainty' && b.kind === 'certainty') return a.certainty === b.certainty
  if (a.kind === 'label' && b.kind === 'label') return a.label === b.label && a.settled === b.settled
  return false
}

function sameConfidence(a: ReviewTileConfidence | undefined, b: ReviewTileConfidence | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.score === b.score && a.certainty === b.certainty
}

/** Field-by-field: a content rebuilt on every render must not redraw an unchanged tile. */
export function sameReviewTileContent(a: ReviewTileContent, b: ReviewTileContent): boolean {
  return (
    a.id === b.id &&
    a.shape === b.shape &&
    a.rows === b.rows &&
    a.title === b.title &&
    a.titleMuted === b.titleMuted &&
    a.titleMono === b.titleMono &&
    a.confirm === b.confirm &&
    a.settled === b.settled &&
    a.timestamp === b.timestamp &&
    a.camera === b.camera &&
    sameBadge(a.badge, b.badge) &&
    sameConfidence(a.confidence, b.confidence)
  )
}

// ── Pieces: what is drawn ─────────────────────────────────────────────────────

export interface ReviewTilePieces {
  /** The corner chip's text, or absent. */
  readonly timeChip: string | undefined
  /** The line on the image's bottom edge, or absent. */
  readonly where: string | undefined
  /** Always the whole tile, whatever is hidden: a screen reader gets everything. */
  readonly accessibilityLabel: string
}

/** Which of the optional pieces render, from the page's display and the row. */
export function reviewTilePieces(
  display: ReviewTileDisplay,
  content: Pick<ReviewTileContent, 'title' | 'camera'>,
  when: string,
): ReviewTilePieces {
  return {
    timeChip: display.showDate ? when : undefined,
    where: display.showCamera ? content.camera : undefined,
    accessibilityLabel: `${content.title} · ${content.camera} · ${when}`,
  }
}
