/**
 * snapshot-load-match — does this image LOAD belong to the candidate on screen?
 *
 * `SnapshotImage` refuses a load event whose URL is not the current candidate's:
 * a slow generation finishing after React selected a newer URL must never become
 * the painted backing frame.
 *
 * The URL comparison is only valid where the platform loads the candidate URL
 * itself. A candidate that carries `headers` (the hosted PWA reaching the hub
 * cross-origin with a Bearer token) is not loaded that way on web:
 * `expo-image`'s web loader cannot put a header on an `<img>`, so it `fetch()`es
 * the bytes and paints an object URL — and the load event reports
 * `blob:https://…`, never the hub URL. Treating that as a foreign generation left
 * every tile's `everLoaded` false and its skeleton over a frame that had already
 * painted, until the 15 s hub timeout lifted it (operator report 2026-10-06:
 * "the tile snapshots appear only after 15–20 s").
 *
 * The object URL needs no generation check of its own: the `<Image>` is keyed by
 * the candidate URL, so a newer candidate is a NEW element and a stale one's
 * events never reach it.
 */

/** The part of a snapshot candidate the match reads. */
export interface SnapshotLoadCandidate {
  readonly uri: string
  readonly headers?: Readonly<Record<string, string>>
}

const OBJECT_URL_PREFIX = 'blob:'

export function isLoadOfCandidate(loadedUrl: string, candidate: SnapshotLoadCandidate): boolean {
  if (loadedUrl === candidate.uri) return true
  return candidate.headers !== undefined && loadedUrl.startsWith(OBJECT_URL_PREFIX)
}
