/**
 * activity-present — the words and numbers one Activity row shows, as pure
 * functions (no React, no i18n runtime: the caller passes `t`).
 */
import type { ActivityItem } from './activity-model.js'
import { formatSelectionDuration } from '../recording/export-selection.js'

/** The state an item row draws. Folds the export states and the snapshot. */
export type ActivityRowState =
  | 'queued'
  | 'rendering'
  | 'ready'
  | 'failed'
  | 'expired'
  | 'running'
  | 'done'

export function rowState(item: ActivityItem): ActivityRowState {
  if (item.kind === 'snapshot') return 'ready'
  if (item.kind === 'job') return item.state
  switch (item.state) {
    case 'queued':
      return 'queued'
    case 'rendering':
      return 'rendering'
    case 'ready':
      return 'ready'
    case 'failed':
      return 'failed'
    case 'expired':
    case 'deleted':
      return 'expired'
  }
}

/** The row's heading: what the job asked for, else the camera the file is of. */
export function rowTitle(item: ActivityItem): string {
  return item.kind === 'job' ? item.title : item.cameraName
}

/** Download / Share are offered only on a finished, still-existing file. */
export function canCollect(item: ActivityItem): boolean {
  return rowState(item) === 'ready'
}

/** Length of an exported period, `m:ss`. */
export function exportDurationLabel(item: ActivityItem): string | null {
  if (item.kind !== 'export') return null
  return formatSelectionDuration(Math.max(0, item.toMs - item.fromMs))
}

/** Whole percent for a running export or job, or null where none is known. */
export function progressPercent(item: ActivityItem): number | null {
  if (item.kind === 'job') {
    if (item.progress === null || item.progress.total <= 0) return null
    return clampPercent((item.progress.done / item.progress.total) * 100)
  }
  if (item.kind !== 'export' || item.progressPct === null) return null
  return clampPercent(item.progressPct)
}

function clampPercent(pct: number): number {
  return Math.round(Math.min(100, Math.max(0, pct)))
}

/** "12/40" for a running job that counts its units, else null. */
export function jobCountLabel(item: ActivityItem): string | null {
  if (item.kind !== 'job' || item.state !== 'running' || item.progress === null) return null
  if (item.progress.total <= 0) return null
  return `${String(item.progress.done)}/${String(item.progress.total)}`
}

/** What a failed job says: the cause, or nothing for an interrupted one (the row words it). */
export function jobFailureReason(item: ActivityItem): string | null {
  return item.kind === 'job' && item.state === 'failed' && !item.interrupted ? item.error : null
}

import { dayRelativeLabel } from '../lib/day-relative-label.js'

/**
 * "Today 14:02" for a snapshot, "Today 14:02–14:03" for an export. The day is
 * named only when it is not today (`dayRelativeLabel`'s rule).
 */
export function whenLabel(item: ActivityItem, nowMs: number, locale: string): string {
  if (item.kind === 'job') return dayRelativeLabel(item.startedAt ?? item.createdAt, nowMs, { locale })
  if (item.kind === 'snapshot') return dayRelativeLabel(item.atMs, nowMs, { locale })
  const from = dayRelativeLabel(item.fromMs, nowMs, { locale })
  const to = new Date(item.toMs).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return `${from}–${to}`
}
