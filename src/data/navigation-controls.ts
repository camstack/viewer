/**
 * The pure half of the robot navigation controls: the drive vocabulary and
 * the dictionary split. Mirrors the `navigation` cap
 * (`packages/types/src/capabilities/navigation.cap.ts`): a nudge is
 * `{ pan, tilt }` in [-1, 1], momentary, repeated at 1 Hz while held.
 */
import { isRecord } from './cap-query.js'

export type NavigationDirection = 'forward' | 'left' | 'right' | 'turnAround'

/** The robot app's cadence while a direction is held. */
export const NAVIGATION_DRIVE_INTERVAL_MS = 1000

export const NAVIGATION_VECTORS: Readonly<Record<NavigationDirection, { readonly pan: number; readonly tilt: number }>> = {
  forward: { pan: 0, tilt: 1 },
  left: { pan: -1, tilt: 0 },
  right: { pan: 1, tilt: 0 },
  turnAround: { pan: 0, tilt: -1 },
}

export interface NavigationEntry {
  readonly id: string
  readonly kind: 'action' | 'sound'
  readonly label: string
  readonly icon: string
  readonly soundId?: number
  readonly enabled: boolean
}

export interface NavigationFeatures {
  readonly move: boolean
  readonly stop: boolean
  readonly goToPoint: boolean
  readonly runAction: boolean
  readonly playSound: boolean
  readonly light: boolean
  readonly lightMode: boolean
}

export interface NavigationStatus {
  readonly mode: string
  readonly following: boolean
  readonly flash: boolean
  readonly lightMode: 'auto' | 'manual'
  readonly lightLevel: number
}

export const NAVIGATION_LIGHT_LEVEL_MIN = 40
export const NAVIGATION_LIGHT_LEVEL_MAX = 100
export const NAVIGATION_LIGHT_LEVEL_STEP = 10

/** Narrow one `listActions` row; a malformed row is dropped, never guessed. */
export function parseNavigationEntry(raw: unknown): NavigationEntry | null {
  if (!isRecord(raw)) return null
  const { id, kind, label, icon, soundId, enabled } = raw
  if (typeof id !== 'string' || typeof label !== 'string' || typeof icon !== 'string') return null
  if (kind !== 'action' && kind !== 'sound') return null
  const entry: { id: string; kind: 'action' | 'sound'; label: string; icon: string; soundId?: number; enabled: boolean } = {
    id,
    kind,
    label,
    icon,
    enabled: enabled === true,
  }
  if (typeof soundId === 'number') entry.soundId = soundId
  return entry
}

export function parseNavigationEntries(raw: unknown): readonly NavigationEntry[] {
  if (!Array.isArray(raw)) return []
  const out: NavigationEntry[] = []
  for (const row of raw) {
    const entry = parseNavigationEntry(row)
    if (entry !== null) out.push(entry)
  }
  return out
}

export function parseNavigationFeatures(raw: unknown): NavigationFeatures | null {
  if (!isRecord(raw)) return null
  const flag = (key: keyof NavigationFeatures): boolean => raw[key] === true
  return {
    move: flag('move'),
    stop: flag('stop'),
    goToPoint: flag('goToPoint'),
    runAction: flag('runAction'),
    playSound: flag('playSound'),
    light: flag('light'),
    lightMode: flag('lightMode'),
  }
}

export function parseNavigationStatus(raw: unknown): NavigationStatus | null {
  if (!isRecord(raw)) return null
  const level = raw.lightLevel
  return {
    mode: typeof raw.mode === 'string' ? raw.mode : 'unknown',
    following: raw.following === true,
    flash: raw.flash === true,
    lightMode: raw.lightMode === 'manual' ? 'manual' : 'auto',
    lightLevel: typeof level === 'number' && Number.isFinite(level) ? level : NAVIGATION_LIGHT_LEVEL_MAX,
  }
}

/** The ENABLED entries of one kind, in catalog order — what the panel draws. */
export function enabledEntries(
  entries: readonly NavigationEntry[],
  kind: NavigationEntry['kind'],
): readonly NavigationEntry[] {
  return entries.filter((entry) => entry.enabled && entry.kind === kind)
}

/** The ENABLED action row with this id, if the device's dictionary has it. */
export function actionEntry(entries: readonly NavigationEntry[], id: string): NavigationEntry | undefined {
  return entries.find((entry) => entry.enabled && entry.kind === 'action' && entry.id === id)
}

/** The next manual level after one stepper press, inside the cap's bounds. */
export function stepLightLevel(level: number, direction: 1 | -1): number {
  const next = level + direction * NAVIGATION_LIGHT_LEVEL_STEP
  return Math.max(NAVIGATION_LIGHT_LEVEL_MIN, Math.min(NAVIGATION_LIGHT_LEVEL_MAX, next))
}
