/**
 * useEventMedia — resolve a displayable image URI for a pipeline-analytics
 * event, with the same priority chain used across the theater UI:
 *   1. `mediaUrl` (served with a Bearer header — caller attaches it).
 *   2. Direct HTTP against an explicit {@link MediaAddress} (optional
 *      `?kind=` / `?variant=thumb`).
 *   3. On image error: if `opts.fallbackAddress` is set, try THAT address over
 *      HTTP. Otherwise mark `failed` — never `getEventMedia` (JPEG through
 *      hub-main).
 *   4. Caller renders its own icon fallback when `failed` is true and no uri.
 *
 * `address` is REQUIRED to be explicit (D482): a bare id can no longer name a
 * media row OR an owner, since an owner is `(table, id)` and a caller holding
 * only a string has no way to say which table. Pass `null` when the caller has
 * no address to try (the `mediaUrl` fast path, or nothing at all) — never a
 * guessed owner type.
 *
 * Returns the resolved `uri`, an `onError` callback, and `failed`. Never throws.
 */

import { useCallback, useEffect, useState } from 'react'
import type { MediaOwnerType } from '@camstack/types'
import { useConnection } from '../connection/ConnectionProvider.js'
import { isRecord } from './cap-query.js'
import { buildMediaIdUrl, buildMediaOwnerUrl, type EventMediaUrlOptions } from './event-media-url.js'

/**
 * What a caller addresses media by — mirrors the plane's two URL forms
 * (D482): a media row's OWN id, or an OWNER's "best media" resolver ladder.
 * Never construct the `owner` form by guessing a type from a string's shape;
 * the caller must know which table the id names.
 */
export type MediaAddress =
  | { readonly kind: 'id'; readonly mediaId: number }
  | { readonly kind: 'owner'; readonly ownerType: MediaOwnerType; readonly ownerId: string }

function mediaAddressUrl(serverUrl: string, address: MediaAddress, opts?: EventMediaUrlOptions): string {
  return address.kind === 'id'
    ? buildMediaIdUrl(serverUrl, address.mediaId, opts)
    : buildMediaOwnerUrl(serverUrl, address.ownerType, address.ownerId, opts)
}

/** A stable string identity for a {@link MediaAddress}, for effect deps —
 *  never sent to the server. */
function addressKey(address: MediaAddress | null | undefined): string {
  if (address === null || address === undefined) return 'none'
  return address.kind === 'id' ? `id:${address.mediaId}` : `owner:${address.ownerType}:${address.ownerId}`
}

/** Opt-in rendering hints for {@link useEventMedia}. */
export interface EventMediaOptions {
  /**
   * The event's owning device. Kept on the options object because callers
   * already pass it (it used to be the authorization subject of the retired
   * `getEventMedia` fallback). The HTTP plane authenticates via Bearer.
   */
  readonly deviceId: number
  /** Direct HTTP rendering:
   *   • 'thumb' — the small center-cropped SQUARE thumbnail (reel / list tiles);
   *   • 'full'  — the full stored blob of `preferKind` (`?kind=…`, e.g. the
   *     640×360 16:9 crop for the timeline cards).
   *  Default `'full'` so a caller that names a kind still goes over HTTP. */
  readonly variant?: 'thumb' | 'full'
  /** Square edge in px for the thumb (server clamps to [64, 320]). */
  readonly size?: number
  /**
   * Request the server's DEFAULT media resolution (no `?kind` on the URL)
   * instead of forcing `preferKind`. The default resolver returns the SUBJECT
   * crop — a per-event `crop`, else the track's `thumbnail` crop — and never
   * the `keyFrame` full frame. Forcing `?kind=crop` is wrong for the ~70% of
   * timeline items whose id is a track id with no per-event crop.
   */
  readonly directDefaultKind?: boolean
  /**
   * HTTP recovery address when the primary `mediaUrl` / `address` errors.
   *
   * Exists because the two are not always the same thing. A clip visit card
   * renders an explicit `mediaUrl` (the visit snapshot) and its own id is an
   * opaque CLIP id the media data plane cannot resolve — so `address` is
   * deliberately `null` there. This carries the visit's main ANALYTICS
   * (object) event, as an explicit `{kind:'owner', ownerType:'object', ...}`.
   */
  readonly fallbackAddress?: MediaAddress
}

export interface EventMedia {
  /** Best available URI (HTTP data-plane, or the raw mediaUrl). */
  readonly uri: string | null
  /** Whether the current `uri` is a `data:` URI (no auth header needed). */
  readonly isData: boolean
  /** All sources exhausted — caller should show an icon. */
  readonly failed: boolean
  /** Call from <Image onError>. Marks failed, or swaps to `fallbackEventId`. */
  readonly onError: () => void
}

/** The resolved surfacing of {@link resolveEventMediaUri}. */
export interface ResolvedEventMediaUri {
  readonly uri: string | null
  readonly isData: boolean
  readonly failed: boolean
}

/**
 * Fold the resolved media sources into the final `{ uri, isData, failed }` the
 * consumer renders. Precedence:
 *   1. a fetched base64 `fallbackUri` (a `data:` URI) always wins;
 *   2. else the direct HTTP `thumbUrl` — UNLESS every source is exhausted
 *      (`failed`), in which case the direct URL is KNOWN-BROKEN and is dropped;
 *   3. else the explicit `mediaUrl` full-frame fast-path, which survives even
 *      when `failed`.
 * `failed` surfaces to the caller only when NO uri remains. Pure — unit-tested.
 */
export function resolveEventMediaUri(args: {
  readonly fallbackUri: string | null
  readonly thumbUrl: string | null
  readonly mediaUrl: string | undefined
  readonly failed: boolean
}): ResolvedEventMediaUri {
  const directUri = args.failed ? null : args.thumbUrl
  const uri: string | null = args.fallbackUri ?? directUri ?? args.mediaUrl ?? null
  return {
    uri,
    isData: uri !== null && uri.startsWith('data:'),
    failed: args.failed && uri === null,
  }
}

function readBase64(item: unknown): string | null {
  if (!isRecord(item)) return null
  const b64 = item.base64
  if (typeof b64 !== 'string' || b64.length === 0) return null
  return b64
}

/** Stored media kinds that carry NO drawn bounding box, in reel/list/grid
 *  representative order. Kept so a caller that still parses a media array
 *  (tests, a leftover admin path) degrades only through CLEAN kinds. */
export const CLEAN_FALLBACK_KINDS: readonly string[] = [
  'thumbnailSmall',
  'thumbnail',
  'keyFrameSmall',
  'crop',
  'keyFrame',
  'fullFrame',
]

/**
 * Pick a base64 image from a media-file array. Kept as a pure helper for the
 * representative chain tests; production rendering uses the HTTP data-plane.
 */
export function extractBase64(raw: unknown, preferKind?: string, cleanOnly = false): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  if (preferKind) {
    const match = raw.find((m) => isRecord(m) && m.kind === preferKind)
    const fromMatch = readBase64(match)
    if (fromMatch !== null) return fromMatch
  }
  if (cleanOnly) {
    for (const kind of CLEAN_FALLBACK_KINDS) {
      const found = readBase64(raw.find((m) => isRecord(m) && m.kind === kind))
      if (found !== null) return found
    }
    return null
  }
  return readBase64(raw[0])
}

/**
 * @param address The explicit {@link MediaAddress} to fetch over HTTP, or
 *   `null` when the caller has none (the `mediaUrl` fast path, or nothing).
 * @param preferKind When set (e.g. `'crop'`, `'fullFrame'`), the HTTP URL
 *   carries `?kind=` unless {@link EventMediaOptions.directDefaultKind} is set.
 */
export function useEventMedia(
  address: MediaAddress | null,
  mediaUrl?: string,
  preferKind?: string,
  opts?: EventMediaOptions,
): EventMedia {
  const { controller, state } = useConnection()
  const [failed, setFailed] = useState(false)
  const [useRecovery, setUseRecovery] = useState(false)

  const recoveryAddress = opts?.fallbackAddress ?? null
  const wantThumb = opts?.variant === 'thumb'
  const forceUrlKind =
    preferKind !== undefined && preferKind.length > 0 && opts?.directDefaultKind !== true
  const serverUrl = state === 'connected' ? (controller.getSystem()?.serverUrl ?? null) : null
  const activeAddress = useRecovery && recoveryAddress !== null ? recoveryAddress : address
  const thumbUrl =
    serverUrl !== null && activeAddress !== null
      ? mediaAddressUrl(serverUrl, activeAddress, {
          ...(wantThumb ? { variant: 'thumb' as const } : {}),
          ...(wantThumb && opts?.size !== undefined ? { size: opts.size } : {}),
          ...(forceUrlKind ? { kind: preferKind } : {}),
        })
      : null

  const addressDepKey = addressKey(address)
  const recoveryDepKey = addressKey(recoveryAddress)

  useEffect(() => {
    setFailed(false)
    setUseRecovery(false)
  }, [addressDepKey, mediaUrl, recoveryDepKey])

  const onError = useCallback((): void => {
    if (!useRecovery && recoveryAddress !== null) {
      setUseRecovery(true)
      return
    }
    setFailed(true)
    // recoveryAddress is re-derived from recoveryDepKey's owning render every
    // time the key changes, so this closure is never stale where it matters.
  }, [useRecovery, recoveryAddress])

  const resolved = resolveEventMediaUri({ fallbackUri: null, thumbUrl, mediaUrl, failed })
  return { uri: resolved.uri, isData: resolved.isData, failed: resolved.failed, onError }
}
