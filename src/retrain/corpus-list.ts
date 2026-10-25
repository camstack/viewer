/**
 * The Retrain grid's list — pure. Newest first and a date label per tile; the
 * grid's geometry is the Library-wide rule (`components/ui/library-grid.ts`).
 */
import type { RetrainFrame } from '@camstack/types'

/** When the frame was captured; the copy time when the hub did not say. */
export function frameTimeOf(frame: Pick<RetrainFrame, 'capturedAt' | 'copiedAt'>): number {
  return frame.capturedAt ?? frame.copiedAt
}

/**
 * One FlashList item is one grid row. The last row keeps its short tail —
 * tiles have a fixed width, so it does not stretch.
 */
export function chunkRetrainRows<T>(items: readonly T[], columns: number): T[][] {
  const width = columns < 1 ? 1 : Math.floor(columns)
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += width) rows.push(items.slice(i, i + width))
  return rows
}

/** Newest first, by capture time (copy time as the fallback); stable on a tie. */
export function sortNewestFirst<T extends Pick<RetrainFrame, 'capturedAt' | 'copiedAt'>>(
  frames: readonly T[],
): T[] {
  return frames
    .map((frame, index) => ({ frame, index }))
    .sort((a, b) => frameTimeOf(b.frame) - frameTimeOf(a.frame) || a.index - b.index)
    .map((entry) => entry.frame)
}

export interface DateLabelWords {
  /** "Today 14:05" */
  readonly today: (time: string) => string
  /** "Yesterday 14:05" */
  readonly yesterday: (time: string) => string
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * "Today 14:05", "Yesterday 14:05", otherwise a short date and time in the
 * locale ("12 Oct, 14:05"); the year only when it is not the current one.
 */
export function frameDateLabel(
  ms: number,
  now: number,
  locale: string,
  words: DateLabelWords,
): string {
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(ms)
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000)
  if (days === 0) return words.today(time)
  if (days === 1) return words.yesterday(time)
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear()
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(ms)
  return `${date}, ${time}`
}
