/**
 * track-media — pure helpers for the unified per-track media gallery.
 *
 * The cluster detail shows ALL media for the selected track in one time-ordered,
 * horizontally-scrollable strip. Two sources feed it:
 *   • the per-scene event frames the detail already resolves (each a full frame
 *     with bounding-box overlay) — carried here as lightweight {@link SceneRef}s;
 *   • `pipelineAnalytics.listTrackMedia({ trackId })` — every stand-alone media
 *     file the pipeline captured for the track (firstFrame / crop / snapshot /
 *     bestFrame / lastFrame / …), carried as {@link TrackMediaFile}s.
 *
 * {@link mergeTrackMedia} folds both into one ordered {@link GalleryItem} list so
 * the component renders N items generically — however many the server returns —
 * and the ordering is deterministic + testable. No React, no `any`.
 */

/** A resolved scene-frame reference (the frame itself lives in the caller's map,
 *  keyed by `key`). Rendered as a full frame + bbox overlay in the hero. */
export interface SceneRef {
  readonly key: string
  readonly timestamp: number
}

/** A stand-alone media file from `listTrackMedia` (manifest, no bytes). */
export interface TrackMediaFile {
  readonly key: string
  readonly kind: string
  readonly timestamp: number
}

/** One entry in the unified gallery: either a scene-frame (has bbox overlay) or a
 *  stand-alone media image (crop / snapshot / …, no overlay). */
export type GalleryItem =
  | { readonly id: string; readonly kind: 'scene'; readonly timestamp: number; readonly sceneKey: string }
  | {
      readonly id: string
      readonly kind: 'media'
      readonly timestamp: number
      readonly mediaKey: string
      readonly mediaKind: string
    }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Parse a raw `listTrackMedia` result into typed media files. Tolerant: skips any
 * malformed row and returns [] for a non-array. Never throws. Bytes are NOT
 * required — the gallery renders each key over HTTP.
 */
export function parseTrackMedia(raw: unknown): TrackMediaFile[] {
  if (!Array.isArray(raw)) return []
  const out: TrackMediaFile[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const key = typeof entry.key === 'string' && entry.key.length > 0 ? entry.key : null
    const kind = typeof entry.kind === 'string' && entry.kind.length > 0 ? entry.kind : null
    const timestamp = typeof entry.timestamp === 'number' ? entry.timestamp : null
    if (key === null || kind === null || timestamp === null) continue
    out.push({ key, kind, timestamp })
  }
  return out
}

/** Media kinds the SIMPLIFIED detail keeps: the main detection crops plus the
 *  clean full frames.
 *   • `crop`       — a per-event detection crop (present only on some events);
 *   • `thumbnail`  — the TRACK's subject crop (clean 16:9). This is the ONLY
 *     subject crop on the ~70% of tracks that carry no per-event crop, so it
 *     MUST be kept — excluding it left the degenerate-track gallery showing only
 *     the `keyFrame` full frame (no subject crop at all);
 *   • `fullFrame`  — the event's full-res clean frame;
 *   • `keyFrame`   — the track's key frame (currently low-res 640×360).
 *  Every other stored variant (boxed renders, first/last cadence frames,
 *  snapshots, debug dumps) is server-side only — the detail does not show them. */
const DETAIL_MEDIA_KINDS: readonly string[] = ['crop', 'thumbnail', 'fullFrame', 'keyFrame']

/**
 * Keep only the media files the simplified track detail shows (see
 * {@link DETAIL_MEDIA_KINDS}). Pure + order-preserving; the low-res full frame
 * remains available through the SCENE items (inference frames), which this
 * filter does not touch.
 */
export function filterDetailMedia(media: readonly TrackMediaFile[]): TrackMediaFile[] {
  return media.filter((f) => DETAIL_MEDIA_KINDS.includes(f.kind))
}

/**
 * Merge scene-frames and stand-alone media into one time-ordered gallery list.
 * Ordering: ascending timestamp (oldest → newest reads left → right); ties break
 * scene-before-media (the overlaid full frame is the richer view of an instant),
 * then by id for total determinism. Ids are namespaced so a scene and a media
 * file can never collide, and duplicate ids are dropped.
 */
export function mergeTrackMedia(
  scenes: readonly SceneRef[],
  media: readonly TrackMediaFile[],
): GalleryItem[] {
  const items: GalleryItem[] = []
  const seen = new Set<string>()

  for (const s of scenes) {
    const id = `scene:${s.key}`
    if (seen.has(id)) continue
    seen.add(id)
    items.push({ id, kind: 'scene', timestamp: s.timestamp, sceneKey: s.key })
  }
  for (const m of media) {
    const id = `media:${m.key}`
    if (seen.has(id)) continue
    seen.add(id)
    items.push({ id, kind: 'media', timestamp: m.timestamp, mediaKey: m.key, mediaKind: m.kind })
  }

  items.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
    if (a.kind !== b.kind) return a.kind === 'scene' ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return items
}
