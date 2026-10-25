/**
 * Record the DECODED live <video> (what the operator sees) via MediaRecorder.
 *
 * Must not clone RTCPeerConnection VIDEO tracks: those can be HEVC, and the
 * point of this path is a shareable H.264/WebM file from pixels already decoded
 * by WebKit. `captureStream` (canvas fallback) is that conversion.
 *
 * AUDIO is the opposite: `HTMLVideoElement.captureStream()` is silent when the
 * element is muted (autoplay / privacy), and the canvas fallback has no audio
 * at all. Clone the live `srcObject` audio tracks onto the recorder stream so
 * the clip has sound without unmuting the speaker.
 */

export const LIVE_CAPTURE_CHUNK_CHARS = 240_000

export function splitBase64Chunks(
  b64: string,
  size: number = LIVE_CAPTURE_CHUNK_CHARS,
): string[] {
  if (size <= 0) return [b64]
  const out: string[] = []
  for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size))
  return out.length === 0 ? [''] : out
}

const MIME_WITH_AUDIO = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
] as const

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp8',
  'video/webm',
] as const

export function pickRecorderMime(
  isTypeSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
  opts?: { readonly audio?: boolean },
): string {
  const list = opts?.audio ? [...MIME_WITH_AUDIO, ...MIME_CANDIDATES] : MIME_CANDIDATES
  for (const candidate of list) {
    try {
      if (isTypeSupported(candidate)) return candidate
    } catch {
      // Some engines throw on an unknown mime instead of returning false.
    }
  }
  return ''
}

/** Decoded video (captureStream / canvas) + live audio from srcObject.
 *  Live VIDEO tracks are ignored — they may be HEVC. Live AUDIO is cloned so
 *  stopping the recorder does not mute the playing stream, and so a muted
 *  <video> (autoplay) still records sound.
 *
 *  Video and audio are separate type parameters: a single `T` made
 *  `getAudioTracks()` return video-shaped mocks (CI TypeScript Check, 1.0.332). */
export function captureRecorderTracks<
  V extends { clone(): V },
  A extends { clone(): A },
>(
  decoded: { getVideoTracks(): readonly V[]; getAudioTracks(): readonly A[] },
  live: { getAudioTracks(): readonly A[] } | null,
): Array<V | A> {
  const video = [...decoded.getVideoTracks()]
  const fromLive = live?.getAudioTracks() ?? []
  const audio =
    fromLive.length > 0
      ? fromLive.map((t) => {
          const cloned = t.clone()
          if ('enabled' in cloned) (cloned as A & { enabled: boolean }).enabled = true
          return cloned
        })
      : [...decoded.getAudioTracks()]
  return [...video, ...audio]
}

export function openDecodedCaptureStream(
  video: HTMLVideoElement,
  fps = 30,
): MediaStream | null {
  const el = video as HTMLVideoElement & {
    captureStream?: (fps?: number) => MediaStream
    mozCaptureStream?: (fps?: number) => MediaStream
  }
  try {
    if (typeof el.captureStream === 'function') {
      const stream = el.captureStream(fps)
      if (stream.getVideoTracks().length > 0) return stream
    }
  } catch {
    // fall through to canvas
  }
  try {
    if (typeof el.mozCaptureStream === 'function') {
      const stream = el.mozCaptureStream(fps)
      if (stream.getVideoTracks().length > 0) return stream
    }
  } catch {
    // fall through to canvas
  }
  return openCanvasCaptureStream(video, fps)
}

function openCanvasCaptureStream(video: HTMLVideoElement, fps: number): MediaStream | null {
  if (video.videoWidth < 2 || video.videoHeight < 2) return null
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx || typeof canvas.captureStream !== 'function') return null
  let running = true
  const draw = (): void => {
    if (!running) return
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    } catch {
      // element may have been detached
    }
    requestAnimationFrame(draw)
  }
  draw()
  const stream = canvas.captureStream(fps)
  const track = stream.getVideoTracks()[0]
  if (track) {
    const stop = track.stop.bind(track)
    track.stop = (): void => {
      running = false
      stop()
    }
  }
  return stream
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result ?? '')
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s)
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

function newCaptureId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export interface LiveCaptureHooks {
  readonly emit: (msg: Record<string, unknown>) => void
  readonly getVideo: () => HTMLVideoElement | null
}

export interface LiveCaptureSession {
  start: () => void
  stop: () => void
  abort: () => void
}

export function createLiveCaptureSession(hooks: LiveCaptureHooks): LiveCaptureSession {
  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let stream: MediaStream | null = null
  let id = ''
  let stopping = false

  const cleanup = (): void => {
    recorder = null
    chunks = []
    stopping = false
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop()
        } catch {
          // already ended
        }
      }
      stream = null
    }
  }

  const fail = (message: string): void => {
    cleanup()
    hooks.emit({ type: 'liveCaptureError', message })
  }

  return {
    start(): void {
      if (recorder) return
      const video = hooks.getVideo()
      if (!video) {
        fail('no video')
        return
      }
      if (typeof MediaRecorder === 'undefined') {
        fail('MediaRecorder missing')
        return
      }
      const captured = openDecodedCaptureStream(video)
      if (!captured) {
        fail('no video')
        return
      }
      const live = video.srcObject instanceof MediaStream ? video.srcObject : null
      const tracks = captureRecorderTracks(captured, live)
      if (live && live.getAudioTracks().length > 0) {
        for (const t of captured.getAudioTracks()) {
          try {
            t.stop()
          } catch {
            // unused silent capture-audio
          }
        }
      }
      const mixed = new MediaStream(tracks)
      stream = mixed
      const hasAudio = tracks.some((t) => t.kind === 'audio')
      const mime = pickRecorderMime(undefined, { audio: hasAudio })
      try {
        recorder = mime
          ? new MediaRecorder(mixed, {
              mimeType: mime,
              videoBitsPerSecond: 2_500_000,
              ...(hasAudio ? { audioBitsPerSecond: 128_000 } : {}),
            })
          : new MediaRecorder(mixed)
      } catch (err) {
        fail(err instanceof Error ? err.message : 'MediaRecorder missing')
        return
      }
      chunks = []
      id = newCaptureId()
      stopping = false
      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data)
      }
      recorder.onerror = () => fail('MediaRecorder missing')
      try {
        recorder.start(1000)
      } catch (err) {
        fail(err instanceof Error ? err.message : 'MediaRecorder missing')
      }
    },
    stop(): void {
      const rec = recorder
      if (!rec || stopping) {
        if (!rec) fail('no video')
        return
      }
      stopping = true
      const captureId = id
      const usedMime = rec.mimeType || 'video/mp4'
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: usedMime })
        cleanup()
        if (blob.size === 0) {
          hooks.emit({ type: 'liveCaptureError', message: 'empty capture' })
          return
        }
        void blobToBase64(blob)
          .then((base64) => {
            hooks.emit({ type: 'liveCaptureStart', id: captureId, mime: usedMime })
            const parts = splitBase64Chunks(base64)
            const total = parts.length
            parts.forEach((data, index) => {
              hooks.emit({ type: 'liveCaptureChunk', id: captureId, index, total, data })
            })
            hooks.emit({ type: 'liveCaptureDone', id: captureId })
          })
          .catch((err: unknown) => {
            hooks.emit({
              type: 'liveCaptureError',
              message: err instanceof Error ? err.message : 'encode failed',
            })
          })
      }
      try {
        if (typeof rec.requestData === 'function') rec.requestData()
        rec.stop()
      } catch (err) {
        fail(err instanceof Error ? err.message : 'stop failed')
      }
    },
    abort(): void {
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          // tearing down
        }
      }
      cleanup()
    },
  }
}
