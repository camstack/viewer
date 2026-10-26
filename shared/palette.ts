/**
 * The one kind→colour read (D939).
 *
 * The hub's `displayPalette.getPalette` is the table. This module holds the
 * answer the screens paint from, and the bundled CamStack preset for the two
 * moments the hub has not given one: before the first read, and when the read
 * is `unknown`. No hex lives here — the preset is `@camstack/types/client`.
 */
import { useCallback, useSyncExternalStore } from 'react'
import {
  bundledCamstack,
  paintHex,
  paletteResultSchema,
  type PaletteReady,
} from '@camstack/types/client'

export type PaletteOrigin = 'pending' | 'hub' | 'unknown'

export interface PaletteView {
  readonly ready: PaletteReady
  readonly origin: PaletteOrigin
  readonly reason: string | null
  readonly serverUrl: string | null
}

export interface AudioPaint {
  readonly hex: string
  readonly alphas: readonly number[]
}

export type KindPaint = (kind: string) => string

const BUNDLED: PaletteReady = bundledCamstack()

const PENDING: PaletteView = {
  ready: BUNDLED,
  origin: 'pending',
  reason: null,
  serverUrl: null,
}

type Listener = () => void

let current: PaletteView = PENDING
const listeners = new Set<Listener>()

function bundledAudioAlphas(): readonly number[] {
  const audio = BUNDLED.swatches.audio
  if (audio === undefined || audio.form !== 'gradient') {
    throw new Error('bundled CamStack palette has no audio gradient')
  }
  return audio.alphas
}

export function bundledView(
  origin: PaletteOrigin,
  reason: string | null,
  serverUrl: string | null,
): PaletteView {
  return { ready: BUNDLED, origin, reason, serverUrl }
}

export function withServer(view: PaletteView, serverUrl: string | null): PaletteView {
  if (view.serverUrl === serverUrl) return view
  return { ...view, serverUrl }
}

/** A payload that does not parse is `unknown`, never the preset pretending to be stored. */
export function resolvePalettePaint(raw: unknown): PaletteView {
  const parsed = paletteResultSchema.safeParse(raw)
  if (!parsed.success) return bundledView('unknown', 'unreadable', null)
  if (parsed.data.status === 'unknown') return bundledView('unknown', parsed.data.reason, null)
  return { ready: parsed.data, origin: 'hub', reason: null, serverUrl: null }
}

export function failureReason(err: unknown): string {
  if (err instanceof Error && err.message.length > 0 && err.message.length <= 120) return err.message
  return 'unreachable'
}

export function paintKind(view: PaletteView, kind: string): string {
  return paintHex(view.ready.swatches, view.ready.fallbacks, kind)
}

export function paintCurrentKind(kind: string): string {
  return paintKind(current, kind)
}

export function audioPaint(view: PaletteView): AudioPaint {
  const swatch = view.ready.swatches.audio
  const hex = swatch !== undefined ? swatch.hex : paintKind(view, 'audio')
  const alphas =
    swatch !== undefined && swatch.form === 'gradient' ? swatch.alphas : bundledAudioAlphas()
  return { hex, alphas }
}

export function audioScaleColors(view: PaletteView = current): readonly string[] {
  const audio = audioPaint(view)
  return audio.alphas.map(
    (alpha) => `${audio.hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`,
  )
}

function sameView(left: PaletteView, right: PaletteView): boolean {
  if (left.origin !== right.origin || left.reason !== right.reason || left.serverUrl !== right.serverUrl) {
    return false
  }
  if (left.ready === right.ready) return true
  return left.origin !== 'hub' && right.origin !== 'hub'
}

export function getPaletteView(): PaletteView {
  return current
}

export function subscribePalette(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setPaletteView(next: PaletteView): void {
  if (sameView(current, next)) return
  current = next
  for (const listener of listeners) listener()
}

export function resetPaletteView(): void {
  setPaletteView(PENDING)
}

export function usePaletteView(): PaletteView {
  return useSyncExternalStore(subscribePalette, getPaletteView, getPaletteView)
}

export function useKindPaint(): KindPaint {
  const view = usePaletteView()
  return useCallback((kind: string): string => paintKind(view, kind), [view])
}
