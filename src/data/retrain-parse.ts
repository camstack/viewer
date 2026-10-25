/**
 * retrain-parse — narrow hub answers for the Library Retrain tab.
 *
 * Every cap read goes through {@link capQuery}, which can return `null` for
 * three different events. These parsers turn a non-null payload into typed
 * rows, or `undefined` when the shape does not match — never silently treat
 * a failed read as an empty worklist.
 *
 * Value schemas stay out of this file: the viewer may only import VALUES from
 * `@camstack/types/client`, and the retrain Zod schemas are not on that entry
 * yet. Structural checks here keep the same refuse-on-malformed contract.
 */
import { isRecord } from './cap-query.js'
import type {
  RetrainAnnotation,
  RetrainAnnotationDraft,
  RetrainFrame,
  RetrainFrameCandidate,
  RetrainFrameList,
  RetrainFrameSelection,
  RetrainMacroClass,
  RetrainTrack,
} from '@camstack/types'

export const RETRAIN_MACROS: readonly RetrainMacroClass[] = [
  'person',
  'vehicle',
  'animal',
  'package',
  'face',
  'plate',
]

/**
 * The macro classes an operator may CHOOSE when annotating. The trainer reads
 * person, vehicle and animal (package rides along); face and plate come from
 * their own cropper models, so they are never offered — an existing face/plate
 * annotation still renders and can be deleted ({@link RETRAIN_MACROS}).
 */
export const RETRAIN_OFFERED_MACROS: readonly RetrainMacroClass[] = [
  'person',
  'vehicle',
  'animal',
  'package',
]

export function isRetrainMacroClass(value: unknown): value is RetrainMacroClass {
  return typeof value === 'string' && (RETRAIN_MACROS as readonly string[]).includes(value)
}

/** JPEG bytes + dimensions for one copied frame. */
export interface RetrainFrameImage {
  readonly base64: string
  readonly width: number
  readonly height: number
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseTrack(row: unknown): RetrainTrack | undefined {
  if (!isRecord(row)) return undefined
  if (typeof row.trackId !== 'string' || row.trackId.length === 0) return undefined
  if (!isFiniteNumber(row.deviceId)) return undefined
  if (typeof row.className !== 'string') return undefined
  if (!isFiniteNumber(row.firstSeen) || !isFiniteNumber(row.lastSeen)) return undefined
  if (!isFiniteNumber(row.frameCount) || !isFiniteNumber(row.annotationCount)) return undefined
  const track: RetrainTrack = {
    trackId: row.trackId,
    deviceId: row.deviceId,
    className: row.className,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    frameCount: row.frameCount,
    annotationCount: row.annotationCount,
  }
  if (typeof row.label === 'string') {
    return { ...track, label: row.label }
  }
  return track
}

export interface RetrainCorpusPageResult {
  readonly frames: readonly RetrainFrame[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
}

export function parseRetrainCorpusPage(raw: unknown): RetrainCorpusPageResult | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.frames)) return undefined
  const { total, page, pageSize } = raw
  if (!isFiniteNumber(total) || !isFiniteNumber(page) || !isFiniteNumber(pageSize)) return undefined
  const frames: RetrainFrame[] = []
  for (const row of raw.frames) {
    const parsed = parseFrame(row)
    if (parsed === undefined) return undefined
    frames.push(parsed)
  }
  return { frames, total, page, pageSize }
}

export function parseRetrainStaging(raw: unknown): readonly RetrainTrack[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: RetrainTrack[] = []
  for (const row of raw) {
    const parsed = parseTrack(row)
    if (parsed === undefined) return undefined
    out.push(parsed)
  }
  return out
}

function parseCandidate(row: unknown): RetrainFrameCandidate | undefined {
  if (!isRecord(row)) return undefined
  if (!isFiniteNumber(row.mediaId)) return undefined
  if (typeof row.kind !== 'string') return undefined
  if (!isFiniteNumber(row.timestamp) || !isFiniteNumber(row.sizeBytes)) return undefined
  if (typeof row.copied !== 'boolean') return undefined
  return {
    mediaId: row.mediaId,
    kind: row.kind as RetrainFrameCandidate['kind'],
    timestamp: row.timestamp,
    sizeBytes: row.sizeBytes,
    copied: row.copied,
  }
}

function parseFrame(row: unknown): RetrainFrame | undefined {
  if (!isRecord(row)) return undefined
  if (typeof row.frameId !== 'string' || row.frameId.length === 0) return undefined
  if (!isFiniteNumber(row.deviceId)) return undefined
  if (row.origin !== 'track' && row.origin !== 'recording') return undefined
  if (typeof row.sourceKind !== 'string') return undefined
  if (!isFiniteNumber(row.sizeBytes) || !isFiniteNumber(row.width) || !isFiniteNumber(row.height)) {
    return undefined
  }
  if (!isFiniteNumber(row.copiedAt) || typeof row.complete !== 'boolean') return undefined
  // Keep the rest of the wire fields if present; the screen only needs the core.
  return row as RetrainFrame
}

export function parseRetrainFrameList(raw: unknown): RetrainFrameList | undefined {
  if (!isRecord(raw)) return undefined
  if (!Array.isArray(raw.candidates) || !Array.isArray(raw.copies)) return undefined
  const candidates: RetrainFrameCandidate[] = []
  for (const row of raw.candidates) {
    const parsed = parseCandidate(row)
    if (parsed === undefined) return undefined
    candidates.push(parsed)
  }
  const copies: RetrainFrame[] = []
  for (const row of raw.copies) {
    const parsed = parseFrame(row)
    if (parsed === undefined) return undefined
    copies.push(parsed)
  }
  return { candidates, copies }
}

export function parseRetrainFrameImage(raw: unknown): RetrainFrameImage | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  const { base64, width, height } = row
  if (typeof base64 !== 'string' || typeof width !== 'number' || typeof height !== 'number') {
    return undefined
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined
  }
  return { base64, width, height }
}

function parseAnnotation(row: unknown): RetrainAnnotation | undefined {
  if (!isRecord(row)) return undefined
  if (typeof row.id !== 'string') return undefined
  if (!isRecord(row.bbox)) return undefined
  const { x, y, w, h } = row.bbox
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) {
    return undefined
  }
  if (!isRetrainMacroClass(row.macroClass)) return undefined
  if (row.kind !== 'subject' && row.kind !== 'model_error') return undefined
  if (
    row.source !== 'operator' &&
    row.source !== 'assist' &&
    row.source !== 'pipeline' &&
    row.source !== 'llm'
  ) {
    return undefined
  }
  return row as RetrainAnnotation
}

export function parseRetrainAnnotations(raw: unknown): readonly RetrainAnnotation[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: RetrainAnnotation[] = []
  for (const row of raw) {
    const parsed = parseAnnotation(row)
    if (parsed === undefined) return undefined
    out.push(parsed)
  }
  return out
}

export function parseRetrainFrameSelection(raw: unknown): RetrainFrameSelection | undefined {
  if (!isRecord(raw)) return undefined
  if (!Array.isArray(raw.copied) || !Array.isArray(raw.refused)) return undefined
  return raw as RetrainFrameSelection
}

/** Pipeline box read from `listRetrainFrames` — parsed at the boundary when the
 *  pinned client types lag the hub schema. */
export interface RetrainPipelineBoxLike {
  readonly bbox: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  readonly macroClass: RetrainAnnotationDraft['macroClass']
  readonly label?: string
  readonly subLabel?: string
  readonly score?: number
  readonly modelId?: string
}

export function parsePipelineBoxes(frame: unknown): readonly RetrainPipelineBoxLike[] {
  if (!isRecord(frame)) return []
  const boxes = frame.pipelineBoxes
  if (!Array.isArray(boxes)) return []
  const out: RetrainPipelineBoxLike[] = []
  for (const row of boxes) {
    if (!isRecord(row) || !isRecord(row.bbox)) continue
    const { x, y, w, h } = row.bbox
    if (typeof x !== 'number' || typeof y !== 'number' || typeof w !== 'number' || typeof h !== 'number') {
      continue
    }
    if (!isRetrainMacroClass(row.macroClass)) continue
    out.push({
      bbox: { x, y, w, h },
      macroClass: row.macroClass,
      label: typeof row.label === 'string' ? row.label : undefined,
      subLabel: typeof row.subLabel === 'string' ? row.subLabel : undefined,
      score: typeof row.score === 'number' ? row.score : undefined,
      modelId: typeof row.modelId === 'string' ? row.modelId : undefined,
    })
  }
  return out
}

export function parseRetrainDrafts(raw: unknown): readonly RetrainAnnotationDraft[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: RetrainAnnotationDraft[] = []
  for (const row of raw) {
    if (!isRecord(row) || !isRecord(row.bbox)) return undefined
    const { x, y, w, h } = row.bbox
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) {
      return undefined
    }
    if (!isRetrainMacroClass(row.macroClass)) return undefined
    if (row.kind !== 'subject' && row.kind !== 'model_error') return undefined
    if (
      row.source !== 'operator' &&
      row.source !== 'assist' &&
      row.source !== 'pipeline' &&
      row.source !== 'llm'
    ) {
      return undefined
    }
    out.push(row as RetrainAnnotationDraft)
  }
  return out
}
