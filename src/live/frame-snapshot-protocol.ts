/**
 * Host side of the embed's frame snapshot: the page answers a `snapshot`
 * command with ONE message (a downscaled JPEG, base64) or a `snapshotError`.
 * Both carry the command's `id`, so a late answer to a request that already
 * timed out cannot be taken for the answer to the next one.
 */

/** A frame the page cut from its <video>. */
export interface FrameSnapshot {
  readonly mime: 'image/jpeg'
  readonly base64: string
  readonly width: number
  readonly height: number
}

export type SnapshotHostMessage =
  | { readonly type: 'snapshot'; readonly id: string; readonly frame: FrameSnapshot }
  | { readonly type: 'snapshotError'; readonly id: string; readonly message: string }

function parseObject(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null ? Object.fromEntries(Object.entries(data)) : null
}

export function parseSnapshotMessage(data: unknown): SnapshotHostMessage | null {
  const m = parseObject(data)
  if (m === null || typeof m.id !== 'string') return null
  if (m.type === 'snapshotError') {
    return { type: 'snapshotError', id: m.id, message: typeof m.message === 'string' ? m.message : 'failed' }
  }
  if (m.type === 'snapshot') {
    if (typeof m.base64 !== 'string' || m.base64.length === 0) return null
    if (typeof m.width !== 'number' || typeof m.height !== 'number') return null
    return {
      type: 'snapshot',
      id: m.id,
      frame: { mime: 'image/jpeg', base64: m.base64, width: m.width, height: m.height },
    }
  }
  return null
}

/** Accept a WebView JSON string or a web postMessage object. */
export function parseSnapshotPayload(raw: unknown): SnapshotHostMessage | null {
  if (typeof raw === 'string') {
    // Cheap sniff first: this runs on every page-to-host message.
    if (!raw.includes('"snapshot')) return null
    try {
      return parseSnapshotMessage(JSON.parse(raw))
    } catch {
      return null
    }
  }
  return parseSnapshotMessage(raw)
}

/** How long to wait for the page before giving up on a snapshot. */
export const SNAPSHOT_TIMEOUT_MS = 8_000

interface Pending {
  readonly resolve: (frame: FrameSnapshot) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

/**
 * Pairs requests with answers by id. One per player; at most a few in flight.
 * `request(send)` runs `send(id)` (inject the command) and resolves with the
 * frame the page posts back under that id.
 */
export class SnapshotBroker {
  private readonly pending = new Map<string, Pending>()
  private seq = 0

  request(send: (id: string) => void, timeoutMs: number = SNAPSHOT_TIMEOUT_MS): Promise<FrameSnapshot> {
    this.seq += 1
    const id = `s${Date.now().toString(36)}${this.seq}`
    return new Promise<FrameSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('snapshot timeout'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      send(id)
    })
  }

  /** Feed a parsed page message; returns true when it was a snapshot answer. */
  accept(message: SnapshotHostMessage): boolean {
    const entry = this.pending.get(message.id)
    if (entry === undefined) return true
    this.pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.type === 'snapshot') entry.resolve(message.frame)
    else entry.reject(new Error(message.message))
    return true
  }
}
