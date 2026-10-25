/**
 * Where a media tile's pixels come from.
 *
 * The track detail used to hold every stored variant as base64 in memory and
 * render `data:` URIs. Measured on the live hub, that cost 5.3 MB (7 files) to
 * 7.67 MB (23 files) per track opened — blocking, before anything painted —
 * for a strip that shows a few hundred KB, and it put a multi-megabyte base64
 * decode on the JS thread.
 *
 * Now the strip is built from a manifest and each tile is an ordinary image
 * URL: the platform fetches it when the tile is on screen, caches it on disk
 * (the data plane serves `immutable` for a year) and decodes it off the JS
 * thread. `?variant=thumb&size=` asks the server for a small square rendering —
 * measured 27 KB against 173 KB for the stored blob.
 *
 * The server URL is ALWAYS preferred when the hub is known — and it is the
 * ROW'S OWN `url` (D482), never reconstructed from `mediaId`: the row already
 * names its own address, and a client-rebuilt path is a second copy of a
 * route that can drift from it (see `event-media-url.ts`). Bytes already in
 * memory are the fallback for a caller with no hub address, nothing more: a
 * `data:` URI of a native key frame is a multi-megabyte string that every
 * re-render of its owner rebuilds and diffs on the JS thread, which is what
 * froze the track detail on 2026-09-06 — while the same image, as a URL, is
 * fetched once, cached on disk and decoded off-thread.
 */

import { absoluteMediaPath, withThumbVariant } from './event-media-url.js'
import type { MediaFileLite } from './track-events.js'

export interface MediaUriOptions {
  /** Ask the server for a small square rendering (strip tiles). Clamped
   *  server-side to 64-320; anything larger silently gets 320. */
  readonly thumbSize?: number
}

/**
 * A renderable URI for one media file, or null when neither bytes nor a
 * row-provided URL are available — the caller renders its own placeholder for
 * null.
 */
export function mediaFileUri(
  file: MediaFileLite | null | undefined,
  serverUrl: string | null,
  opts?: MediaUriOptions,
): string | null {
  if (file === null || file === undefined) return null
  if (file.url !== undefined && file.url.length > 0) {
    const abs = absoluteMediaPath(serverUrl, file.url)
    if (abs !== null) {
      return opts?.thumbSize !== undefined ? withThumbVariant(abs, opts.thumbSize) : abs
    }
  }
  if (file.base64 !== undefined && file.base64.length > 0) {
    return `data:image/jpeg;base64,${file.base64}`
  }
  return null
}

/**
 * An `expo-image` source for a media URI, carrying auth when the URI is a
 * server URL.
 *
 * The media data plane is AUTHENTICATED. A URL-backed tile rendered without the
 * Authorization header shows a broken-image glyph — which is precisely how the
 * whole detail strip went blank the first time the URL rendering shipped. A
 * `data:` URI needs no header and must not be given one.
 */
export function mediaImageSource(
  uri: string | null,
  headers: Record<string, string> | undefined,
): { uri: string; headers?: Record<string, string> } {
  if (uri === null) return { uri: '' }
  if (uri.startsWith('data:') || headers === undefined) return { uri }
  return { uri, headers }
}
