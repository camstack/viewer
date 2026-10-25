/**
 * activity-reconcile — lay the event stream's live progress over the polled
 * export records, so a rendering row advances between polls.
 */
import type { ExportRecord, ExportState } from '../data/use-exports.js'

export interface LiveExportOverlay {
  readonly progressPct: number | null
  readonly state: ExportState
}

/**
 * The records with each live overlay applied. An overlay never resurrects a
 * finished record: once the poll says `ready`, a late `progress` event for the
 * same id is stale.
 */
export function activeExportRecords(
  records: readonly ExportRecord[],
  live: Readonly<Record<string, LiveExportOverlay>>,
): readonly ExportRecord[] {
  return records.map((record) => {
    const overlay = live[record.id]
    if (overlay === undefined) return record
    const polledRunning = record.state === 'queued' || record.state === 'rendering'
    if (!polledRunning) return record
    return { ...record, state: overlay.state, progressPct: overlay.progressPct }
  })
}
