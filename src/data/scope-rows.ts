/**
 * scope-rows — reading the envelope of a batched, per-camera hub answer.
 *
 * The three timeline batches all answer the same shape: an array of rows, each
 * carrying `deviceId`, `read: 'read' | 'unreadable'`, and one payload field
 * whose name differs per method (`ranges`, `buckets`, `days`). This module
 * parses the part that is common; the payload stays with the hook that knows
 * what it means.
 *
 * A row missing `deviceId` or carrying a `read` value this build does not know
 * is DROPPED rather than defaulted to `'read'`. The consequence is deliberate:
 * a dropped row leaves its camera with no answer at all, and
 * `resolveScopeKnowledge` then reports that camera as unknown — which is the
 * honest reading of a row we could not understand. Defaulting the other way
 * would let a malformed answer claim "read, and empty".
 */
import { isRecord } from './cap-query.js'
import type { ScopeReadRow } from '../components/camera/theater/timeline-scope-read.js'

/** The rows of a batch answer, or `[]` when the answer is not an array (an
 *  absent cap answers `null` through `capQuery`, which is a real answer). */
export function scopeRowsOf(raw: unknown): readonly unknown[] {
  return Array.isArray(raw) ? raw : []
}

/** `{ deviceId, read }` off one raw row; null when the row is not one. */
export function parseScopeRowHead(raw: unknown): ScopeReadRow | null {
  if (!isRecord(raw)) return null
  if (typeof raw.deviceId !== 'number') return null
  if (raw.read !== 'read' && raw.read !== 'unreadable') return null
  return { deviceId: raw.deviceId, read: raw.read }
}

/** Every row's envelope, in wire order, malformed rows dropped. */
export function parseScopeRowHeads(raw: unknown): readonly ScopeReadRow[] {
  const heads: ScopeReadRow[] = []
  for (const row of scopeRowsOf(raw)) {
    const head = parseScopeRowHead(row)
    if (head !== null) heads.push(head)
  }
  return heads
}

/** True when this row may be believed — i.e. it answered. A row that says
 *  `unreadable` carries an EMPTY payload that means nothing, so folding it into
 *  a union would silently turn "nobody looked" into "nothing there". */
export function isReadRow(raw: unknown): boolean {
  return parseScopeRowHead(raw)?.read === 'read'
}
