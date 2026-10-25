/**
 * useTrackPlate — resolve a track's recognized plate (crop URL, or a
 * leftover inline crop) from the `plateGallery` cap, so the detail modal can
 * surface a PLATE tile even when the plate crop lives ONLY in the plate
 * gallery (no `plateCrop` event/track media row). Fetches
 * `plateGallery.getPlateByTrack({ deviceId, trackId })`.
 *
 * Defensive: disabled until connected + a track is selected; returns null on
 * error / older hubs / no plate. Pure parser (`parsePlateInfo`) is unit-tested.
 */
import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery, isRecord } from './cap-query.js'
import type { PlateFallback } from './track-media-groups.js'

/** A track's plate read, normalised for the detail modal. */
export interface TrackPlate extends PlateFallback {
  /** OCR / corrected plate text (e.g. "WDMUN5Z"). */
  readonly text: string
}

/** The `/m/<mediaId>` address prefix (D482) — the ONLY form a hub-stamped
 *  `cropUrl` can be parsed back into a numeric id from. The `/o/<ownerType>/
 *  <ownerId>` owner form names no row and is never parsed here. */
const EVENT_MEDIA_ID_PREFIX = '/addon/pipeline-analytics/event-media/m/'

const DIGITS_ONLY = /^\d+$/

/**
 * The media row's own id, parsed off a hub-stamped `cropUrl` that points at
 * `/m/<mediaId>` (D482), or `undefined` when it cannot be read this way — a
 * legacy hub's pre-D482 URL, an owner-form URL, or a malformed one. NEVER `0`:
 * a row that cannot be addressed by id has no id, not the id of row zero.
 */
export function mediaIdFromCropUrl(cropUrl: string): number | undefined {
  const q = cropUrl.indexOf('?')
  const path = q >= 0 ? cropUrl.slice(0, q) : cropUrl
  const idx = path.indexOf(EVENT_MEDIA_ID_PREFIX)
  if (idx < 0) return undefined
  const rest = path.slice(idx + EVENT_MEDIA_ID_PREFIX.length)
  if (rest.length === 0 || !DIGITS_ONLY.test(rest)) return undefined
  return Number(rest)
}

/**
 * Narrow a raw `plateGallery.getPlateByTrack` row into a {@link TrackPlate}, or
 * null when malformed / no image (a tile needs a URL or bytes). Never throws.
 */
export function parsePlateInfo(raw: unknown): TrackPlate | null {
  if (!isRecord(raw)) return null
  if (typeof raw.plateId !== 'string' || raw.plateId.length === 0) return null
  const cropUrl = typeof raw.cropUrl === 'string' && raw.cropUrl.length > 0 ? raw.cropUrl : undefined
  const base64 = typeof raw.base64 === 'string' && raw.base64.length > 0 ? raw.base64 : undefined
  if (cropUrl === undefined && base64 === undefined) return null
  const mediaId = cropUrl !== undefined ? mediaIdFromCropUrl(cropUrl) : undefined
  return {
    plateId: raw.plateId,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : 0,
    text: typeof raw.text === 'string' ? raw.text : '',
    cropUrl,
    mediaId,
    base64,
  }
}

export function useTrackPlate(
  deviceId: number,
  trackId: string,
  enabled: boolean,
): { plate: TrackPlate | null; loading: boolean } {
  const { controller, state } = useConnection()
  const query = useQuery<TrackPlate | null>({
    queryKey: ['v2', 'plate', 'by-track', deviceId, trackId],
    enabled: enabled && state === 'connected',
    staleTime: 60_000,
    queryFn: async (): Promise<TrackPlate | null> => {
      const system = controller.getSystem()
      if (!system) return null
      const client = system.trpcClient as Record<string, unknown>
      const raw = await capQuery(client, 'plateGallery', 'getPlateByTrack', { deviceId, trackId })
      return parsePlateInfo(raw)
    },
  })
  return { plate: query.data ?? null, loading: query.isLoading }
}
