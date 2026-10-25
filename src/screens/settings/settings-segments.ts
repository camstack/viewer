/**
 * settings-segments — the segment contract of the Settings tab, factored out as
 * a pure (RN-free) module so it is unit testable, like `library-sections.ts`.
 *
 * The page had grown to nine sections in one scroll. They are grouped by WHY
 * the operator opens Settings (operator-approved design, 2026-10-08):
 *
 *   • Account  — who is signed in, how they sign in, which hubs this device
 *                knows, and the share links this account handed out.
 *   • Viewing  — everything global about watching a camera: stream defaults,
 *                the timeline under it, the highlight, and the camera list.
 *   • App      — set once at install: theme, language, haptics, settings
 *                profiles, version and updates.
 *   • Advanced — the diagnostic and destructive end: network routes, debug
 *                and logs, export / clear cache / reset.
 *
 * The segment last shown is kept for the SESSION only (`device-settings-store`,
 * an ephemeral field): a new launch opens on the default.
 */
import type { SegmentOption } from '../../components/ui/SegmentedControl.js'

export type SettingsSegmentKey = 'account' | 'viewing' | 'app' | 'advanced'

export const SETTINGS_SEGMENT_ORDER: readonly SettingsSegmentKey[] = [
  'account',
  'viewing',
  'app',
  'advanced',
]

/** Shown on a device that never picked one. */
export const DEFAULT_SETTINGS_SEGMENT: SettingsSegmentKey = 'account'

export const SETTINGS_SEGMENT_LABEL_KEYS: Readonly<Record<SettingsSegmentKey, string>> = {
  account: 'v2.settings.segments.account',
  viewing: 'v2.settings.segments.viewing',
  app: 'v2.settings.segments.app',
  advanced: 'v2.settings.segments.advanced',
}

export function buildSettingsSegments(
  t: (key: string) => string,
): readonly SegmentOption<SettingsSegmentKey>[] {
  return SETTINGS_SEGMENT_ORDER.map((value) => ({ value, label: t(SETTINGS_SEGMENT_LABEL_KEYS[value]) }))
}
