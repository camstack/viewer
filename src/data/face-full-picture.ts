/**
 * face-full-picture — which full frame a face crop came from, the rule half.
 *
 * Operator, 2026-10-23: from a face opened in Library → People there was no
 * way to see the picture the crop was cut from. The hub already says it: every
 * face row names its `trackId`, and a face written after design B also names
 * the track's native key frame (`keyFrameMediaId`) and the face's box on it
 * (`faceBbox`, in that frame's pixels).
 *
 * The rule this module owns is that the full picture is THAT key frame or
 * nothing. A track's "best media" by owner is another frame of the same track,
 * and the face box would be drawn over a picture it was not measured on — a
 * box in the wrong place reads as the recognizer having looked at the wrong
 * person. So a row without `keyFrameMediaId` reports `null`, and the detail
 * says the hub kept no full picture for it.
 *
 * Pure and RN-free — `__tests__/face-full-picture.spec.ts`.
 */
import { buildMediaIdUrl } from './event-media-url.js'
import type { FaceBox } from './use-face-gallery.js'

/** What the detail needs to draw the full picture. */
export interface FaceFullPicture {
  /** Absolute URL of the native key frame on the event-media plane. */
  readonly uri: string
  /** The face's box on it, in the frame's pixels; absent on legacy rows. */
  readonly box: FaceBox | undefined
}

/** The full picture a face was cropped from, or `null` when the hub kept none. */
export function faceFullPicture(
  row: { readonly keyFrameMediaId?: number; readonly faceBbox?: FaceBox },
  serverUrl: string | null,
): FaceFullPicture | null {
  if (row.keyFrameMediaId === undefined || serverUrl === null) return null
  return { uri: buildMediaIdUrl(serverUrl, row.keyFrameMediaId), box: row.faceBbox }
}
