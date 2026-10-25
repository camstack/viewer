/**
 * When a snapshot surface may ask for its JPEG.
 *
 * A sized tile on native does not wait for `snapshot.getSnapshotLinks`. That
 * call is also a capture order and, measured on the prod hub, held eight
 * card-width tiles for about a second before any image request started. The
 * width-scoped media URL can be fetched in parallel; the link poll still
 * names the camera and replaces the URL when it answers.
 *
 * Web keeps waiting. A stable URL there is a browser-cache key, and painting
 * it before the hub has named a frame is how a stale JPEG came back.
 */
export interface SnapshotThumbnailFetchInput {
  readonly enabled: boolean
  readonly hasServerUrl: boolean
  readonly targetWidth: number | undefined
  readonly linkRenderable: boolean
  readonly linksReady: boolean
  readonly linksSupported: boolean
  /** Native file cache. Web is false. */
  readonly nativeFileCache: boolean
}

export function snapshotThumbnailFetchReady(input: SnapshotThumbnailFetchInput): boolean {
  if (!input.enabled) return false
  if (input.linkRenderable) return true
  if (input.linksReady && !input.linksSupported) return true
  return (
    input.nativeFileCache &&
    input.hasServerUrl &&
    input.targetWidth !== undefined &&
    input.targetWidth > 0
  )
}
