/**
 * Which LEVEL each field of the settings document lives at — the one
 * declaration (operator decision 2026-10-21).
 *
 *   device   never leaves this install: what depends on the screen, the
 *            network or the hardware (toolbar density, card width, reel
 *            thumbnail size, gallery density, the device-info pill, the
 *            stream-screen nav bar, pinch-grows-height, vibration)
 *   account  per user, per hub, kept on the hub and synced to every device of
 *            that user (`account/account-settings-sync.ts`)
 *
 * Exhaustive by TYPE: a field added to `AppSettings` does not compile until
 * somebody decides its level, so the decision cannot be forgotten. Each field
 * has exactly one level — there are no overrides.
 *
 * The two projections are allow-lists rebuilt from this table, so a key an
 * older build wrote is dropped rather than passed through to either side.
 */
import type { AppSettings } from './settings-store.js'

export type SettingLevel = 'device' | 'account'

type FieldLevels<T> = { readonly [K in keyof T]-?: SettingLevel }

/** A level per leaf: an object section has one per field, a scalar has one. */
export type SettingsLevels = {
  readonly [S in keyof AppSettings]-?: AppSettings[S] extends string ? SettingLevel : FieldLevels<AppSettings[S]>
}

export const SETTINGS_LEVELS: SettingsLevels = {
  grid: { motionHoldSec: 'account' },
  stream: {
    audioOnOpen: 'account',
    reopenLastCamera: 'account',
    clipLoop: 'account',
    pinchExpandsHeight: 'device',
    navBarOnStream: 'device',
    toolbarDensity: 'device',
    landscapeTimeline: 'device',
  },
  highlight: { motionColor: 'account', audioColor: 'account', detectionColor: 'account', thickness: 'account' },
  clusters: { gapPercent: 'account', showClass: 'account', cardWidthFraction: 'device' },
  events: {
    reelThumbSize: 'device',
    // A migration stamp travels with the field it stamps.
    reelThumbSizeRev: 'device',
    gridDensity: 'device',
    reelLabelMode: 'account',
    reelChromeRev: 'account',
    tileLabelMode: 'account',
    tileDetailCamera: 'account',
    tileDetailZone: 'account',
  },
  // Same level as the events tiles' details (`tileDetailCamera`): a reading
  // preference of the person, not of the screen.
  review: { facesShowDate: 'account', facesShowCamera: 'account', platesShowDate: 'account', platesShowCamera: 'account' },
  cameraList: { motionBorder: 'account', motionBadge: 'account', occupancy: 'account' },
  deviceInfo: 'device',
  haptics: { enabled: 'device', motion: 'device', detection: 'device', person: 'device', uiFeedback: 'device' },
}

type JsonRecord = Readonly<Record<string, unknown>>

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Every leaf as `section.field` (or `section` for a scalar), with its level. */
export function settingsLeafLevels(): readonly { readonly path: string; readonly level: SettingLevel }[] {
  return Object.entries(SETTINGS_LEVELS).flatMap(([section, levels]) =>
    typeof levels === 'string'
      ? [{ path: section, level: levels }]
      : Object.entries(levels).map(([field, level]) => ({ path: `${section}.${field}`, level })),
  )
}

/**
 * The fields of a stored settings document (parsed or raw) that live at
 * `level`, as a partial document. Fields absent from the input stay absent.
 */
export function pickSettingsLevel(doc: unknown, level: SettingLevel): Record<string, unknown> {
  if (!isRecord(doc)) return {}
  const out: Record<string, unknown> = {}
  for (const [section, levels] of Object.entries(SETTINGS_LEVELS)) {
    const value = doc[section]
    if (value === undefined) continue
    if (typeof levels === 'string') {
      if (levels === level) out[section] = value
      continue
    }
    if (!isRecord(value)) continue
    const picked: Record<string, unknown> = {}
    for (const [field, fieldLevel] of Object.entries(levels)) {
      if (fieldLevel === level && value[field] !== undefined) picked[field] = value[field]
    }
    if (Object.keys(picked).length > 0) out[section] = picked
  }
  return out
}

/** The device half and the account half, joined into one partial document. */
export function joinSettingsLevels(device: unknown, account: unknown): Record<string, unknown> {
  const a = pickSettingsLevel(device, 'device')
  const b = pickSettingsLevel(account, 'account')
  const out: Record<string, unknown> = { ...a }
  for (const [section, value] of Object.entries(b)) {
    const existing = out[section]
    out[section] = isRecord(existing) && isRecord(value) ? { ...existing, ...value } : value
  }
  return out
}
