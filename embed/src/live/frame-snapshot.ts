/**
 * Cut the CURRENT frame of the player's <video> as a JPEG and hand it to the
 * host.
 *
 * One path for live and recorded playback: both draw into the same element, so
 * "the frame on screen" is whatever it holds. Drawn through a canvas, never
 * through a hub call — the operator asked for the frame they are LOOKING at,
 * and a hub snapshot would be the camera's present, not the playhead's past.
 *
 * Long edge capped (a 4K frame as a base64 string through the WebView bridge is
 * megabytes for no visible gain on a phone).
 */

/** Longest side of the delivered JPEG, px. */
export const SNAPSHOT_MAX_EDGE = 2560
export const SNAPSHOT_QUALITY = 0.9

export interface SnapshotFrame {
  readonly base64: string
  readonly width: number
  readonly height: number
}

export interface SnapshotSize {
  readonly width: number
  readonly height: number
}

/** The delivered size for a source frame: scaled DOWN to the cap, never up. */
export function snapshotSize(videoWidth: number, videoHeight: number): SnapshotSize {
  const longest = Math.max(videoWidth, videoHeight)
  if (longest <= SNAPSHOT_MAX_EDGE) return { width: videoWidth, height: videoHeight }
  const scale = SNAPSHOT_MAX_EDGE / longest
  return { width: Math.round(videoWidth * scale), height: Math.round(videoHeight * scale) }
}

/** The base64 body of a data URL, or null when it is not one. */
export function dataUrlBody(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(',')
  return dataUrl.startsWith('data:') && comma >= 0 ? dataUrl.slice(comma + 1) : null
}

/** Draw the video's current frame to a JPEG; `null` when there is no picture. */
export function drawFrameJpeg(video: HTMLVideoElement): SnapshotFrame | null {
  if (video.videoWidth < 2 || video.videoHeight < 2) return null
  if (typeof document === 'undefined') return null
  const { width, height } = snapshotSize(video.videoWidth, video.videoHeight)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    ctx.drawImage(video, 0, 0, width, height)
    const base64 = dataUrlBody(canvas.toDataURL('image/jpeg', SNAPSHOT_QUALITY))
    return base64 === null || base64.length === 0 ? null : { base64, width, height }
  } catch {
    // A tainted canvas or a detached element: no frame to give.
    return null
  }
}

export interface FrameSnapshotHooks {
  readonly emit: (msg: Record<string, unknown>) => void
  readonly getVideo: () => HTMLVideoElement | null
}

/** Answer a host `snapshot` command: a `snapshot` message, or `snapshotError`. */
export function takeSnapshot(hooks: FrameSnapshotHooks, id: string): void {
  const video = hooks.getVideo()
  const frame = video === null ? null : drawFrameJpeg(video)
  if (frame === null) {
    hooks.emit({ type: 'snapshotError', id, message: 'no frame' })
    return
  }
  hooks.emit({ type: 'snapshot', id, base64: frame.base64, width: frame.width, height: frame.height })
}
