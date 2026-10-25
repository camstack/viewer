/**
 * Pure presentational helpers for the Exports UI (screen + modal). Kept
 * framework-free so they can be unit-tested and shared. Localised strings are
 * produced through an injected translate fn (i18next `t`-compatible).
 */
import type { ExportOptions, ExportRecord, ExportState } from './use-exports.js'

/** Minimal i18next translate signature these helpers need. */
export type Translate = (key: string, opts?: Record<string, unknown>) => string

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Human byte size (e.g. "12.4 MB"). Null / 0 renders as "—". */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** Compact duration for a span in ms (e.g. "1h 05m", "45s"). */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/** Clock label (HH:MM) for an epoch. */
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** Full range label: "12 Jul, 14:30 → 14:45 (15m)". */
export function rangeLabel(fromMs: number, toMs: number): string {
  const day = new Date(fromMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const sameDay = new Date(fromMs).toDateString() === new Date(toMs).toDateString()
  const end = sameDay
    ? clock(toMs)
    : `${new Date(toMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${clock(toMs)}`
  return `${day}, ${clock(fromMs)} → ${end} (${formatDuration(toMs - fromMs)})`
}

/** Render-variant label: "1×", "Accelerated 4×", "Slow 0.5×", "Timelapse", ± audio. */
export function variantLabel(options: ExportOptions, t: Translate): string {
  let base: string
  if (options.timelapse !== undefined) {
    base = t('v2.exports.variantTimelapse')
  } else {
    const speed = options.speed ?? 1
    base =
      speed === 1
        ? t('v2.exports.variantRegular')
        : speed > 1
          ? t('v2.exports.variantAccelerated', { speed })
          : t('v2.exports.variantSlow', { speed })
  }
  const audio = options.timelapse === undefined && options.includeAudio
  return audio ? `${base} · ${t('v2.exports.withAudio')}` : base
}

/** Expiry countdown label: "Expires in 6d", "Expires in 3h", or "Expired". */
export function expiryLabel(expiresAt: number, now: number, t: Translate): string {
  const remaining = expiresAt - now
  if (remaining <= 0) return t('v2.exports.expired')
  if (remaining >= DAY_MS) return t('v2.exports.expiresInDays', { count: Math.floor(remaining / DAY_MS) })
  if (remaining >= HOUR_MS) return t('v2.exports.expiresInHours', { count: Math.floor(remaining / HOUR_MS) })
  return t('v2.exports.expiresInMinutes', { count: Math.max(1, Math.floor(remaining / MINUTE_MS)) })
}

/** Localised state label. */
export function stateLabel(state: ExportState, t: Translate): string {
  return t(`v2.exports.state.${state}`)
}

/** Effective progress (0–100) for a rendering row, merging a live event value. */
export function effectiveProgress(rec: ExportRecord, livePct: number | null | undefined): number | null {
  if (rec.state !== 'rendering' && rec.state !== 'queued') return null
  if (typeof livePct === 'number') return Math.max(0, Math.min(100, livePct))
  if (typeof rec.progressPct === 'number') return Math.max(0, Math.min(100, rec.progressPct))
  return null
}
