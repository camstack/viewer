/**
 * events-theme — the two palettes of the events embed and the class accent map.
 *
 * The embed's `index.css` hard-codes a black page (`color-scheme: dark`) because
 * every other mode is a chrome-less video surface. The events embed is the first
 * one that can legitimately sit on a LIGHT host, so it owns its own surface
 * colours and stamps `color-scheme` at mount — inline, not via Tailwind, for the
 * same reason the other pages use inline styles: no utility class emitted only
 * from this file can be dropped by a content scan that never sees it.
 */
import { getPaletteView, paintKind, type PaletteView } from '../../../shared/palette'

export interface EventsPalette {
  readonly background: string
  readonly card: string
  readonly cardHover: string
  readonly border: string
  readonly text: string
  readonly textMuted: string
  readonly skeleton: string
  readonly chip: string
  readonly colorScheme: 'dark' | 'light'
}

export const DARK_PALETTE: EventsPalette = {
  background: '#09090b',
  card: '#18181b',
  cardHover: '#27272a',
  border: '#27272a',
  text: '#fafafa',
  textMuted: '#a1a1aa',
  skeleton: '#27272a',
  chip: '#3f3f46',
  colorScheme: 'dark',
}

export const LIGHT_PALETTE: EventsPalette = {
  background: '#ffffff',
  card: '#f4f4f5',
  cardHover: '#e4e4e7',
  border: '#e4e4e7',
  text: '#18181b',
  textMuted: '#71717a',
  skeleton: '#e4e4e7',
  chip: '#d4d4d8',
  colorScheme: 'light',
}

/** Resolve the palette. `auto` follows the host's `prefers-color-scheme`; the
 *  preference is passed in (not read here) so the rule stays pure. */
export function resolvePalette(
  theme: 'auto' | 'dark' | 'light',
  prefersDark: boolean,
): EventsPalette {
  if (theme === 'light') return LIGHT_PALETTE
  if (theme === 'dark') return DARK_PALETTE
  return prefersDark ? DARK_PALETTE : LIGHT_PALETTE
}

/** Accent colour per class, from the hub palette. An audio episode is the audio entry even when its name is a video class. */
export function accentForClass(
  className: string,
  isAudioClass = false,
  view: PaletteView = getPaletteView(),
): string {
  if (isAudioClass) return paintKind(view, 'audio')
  return paintKind(view, className)
}

/**
 * The REEL's time label — always `HH:MM`, locale-formatted, no date.
 *
 * Mirrors the native reel footer's `hhmm` exactly: the strip has room for one
 * short line and a date would either wrap or ellipsis away the time itself. The
 * gallery, which has room, uses {@link formatEventTime}.
 */
export function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export { formatEventTime } from '../../../shared/events/events-time'
