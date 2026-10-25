/**
 * Host-side live-capture protocol: chunked embed→host messages plus the
 * helpers that reassemble them into a shareable file.
 *
 * The clip is the DECODED live picture (MediaRecorder on the <video> element),
 * not an archive remux. Chunks exist because a multi-minute recording as one
 * postMessage can exceed the WKWebView bridge.
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

export type LiveCaptureHostMessage =
  | { readonly type: 'liveCaptureStart'; readonly id: string; readonly mime: string }
  | {
      readonly type: 'liveCaptureChunk'
      readonly id: string
      readonly index: number
      readonly total: number
      readonly data: string
    }
  | { readonly type: 'liveCaptureDone'; readonly id: string }
  | { readonly type: 'liveCaptureError'; readonly message: string }

export type LiveCaptureBytes = { readonly mime: string; readonly base64: string }

export type LiveCapturePushResult =
  | { readonly kind: 'complete'; readonly mime: string; readonly base64: string }
  | { readonly kind: 'error'; readonly message: string }
  | null

export function parseLiveCaptureMessage(data: unknown): LiveCaptureHostMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const m = data as Record<string, unknown>
  if (m.type === 'liveCaptureStart') {
    if (typeof m.id !== 'string' || typeof m.mime !== 'string') return null
    return { type: 'liveCaptureStart', id: m.id, mime: m.mime }
  }
  if (m.type === 'liveCaptureChunk') {
    if (typeof m.id !== 'string' || typeof m.data !== 'string') return null
    if (typeof m.index !== 'number' || typeof m.total !== 'number') return null
    return {
      type: 'liveCaptureChunk',
      id: m.id,
      index: m.index,
      total: m.total,
      data: m.data,
    }
  }
  if (m.type === 'liveCaptureDone') {
    if (typeof m.id !== 'string') return null
    return { type: 'liveCaptureDone', id: m.id }
  }
  if (m.type === 'liveCaptureError') {
    if (typeof m.message !== 'string') return null
    return { type: 'liveCaptureError', message: m.message }
  }
  return null
}

/** Accept a WebView JSON string or a web postMessage object. */
export function parseLiveCapturePayload(raw: unknown): LiveCaptureHostMessage | null {
  if (typeof raw === 'string') {
    try {
      return parseLiveCaptureMessage(JSON.parse(raw) as unknown)
    } catch {
      return null
    }
  }
  return parseLiveCaptureMessage(raw)
}

interface PendingCapture {
  mime: string
  total: number
  parts: (string | undefined)[]
}

export class LiveCaptureAssembler {
  private readonly pending = new Map<string, PendingCapture>()

  push(msg: LiveCaptureHostMessage): LiveCapturePushResult {
    if (msg.type === 'liveCaptureError') {
      this.pending.clear()
      return { kind: 'error', message: msg.message }
    }
    if (msg.type === 'liveCaptureStart') {
      this.pending.set(msg.id, { mime: msg.mime, total: 0, parts: [] })
      return null
    }
    if (msg.type === 'liveCaptureChunk') {
      let session = this.pending.get(msg.id)
      if (!session) {
        session = { mime: 'video/mp4', total: msg.total, parts: [] }
        this.pending.set(msg.id, session)
      }
      session.total = msg.total
      session.parts[msg.index] = msg.data
      return null
    }
    const session = this.pending.get(msg.id)
    this.pending.delete(msg.id)
    if (!session || session.total <= 0) {
      return { kind: 'error', message: 'incomplete capture' }
    }
    const parts: string[] = []
    for (let i = 0; i < session.total; i++) {
      const part = session.parts[i]
      if (typeof part !== 'string') return { kind: 'error', message: 'incomplete capture' }
      parts.push(part)
    }
    return { kind: 'complete', mime: session.mime, base64: parts.join('') }
  }
}

export function captureFileExtension(mime: string): 'mp4' | 'webm' {
  return mime.includes('webm') ? 'webm' : 'mp4'
}
