/**
 * nc-tabs — the section contract of the Notification Center screen, factored
 * out as a pure (RN-free) module so it is unit-testable in the repo's node test
 * environment. The screen renders a `ScopeBar` from {@link buildNcTabs}.
 *
 *   • Rules   — admin/global rules (read-only) + the caller's personal rules (B4).
 *   • Targets — the caller's own delivery destinations (B3).
 *   • Snooze  — the windows silencing the caller, and the control to open one.
 *   • Alarm   — ADMIN ONLY: the alarm panel's configuration (operator,
 *               2026-10-23: "Allarme deve essere una nuova sezione"). Offered
 *               on a CONFIRMED admin verdict alone — pending and unknown keep it
 *               hidden, as the entry row it replaces did (every `nc.*Alarm*`
 *               action is admin-only).
 *
 * Rules is the default tab (first in {@link NC_TAB_ORDER}).
 */
import type { SegmentOption } from '../../components/ui/SegmentedControl.js'
import type { AdminVerdict } from '../../data/use-me.js'

/** Discriminant for the Notification Center's sections. */
export type NcTabKey = 'rules' | 'targets' | 'snooze' | 'alarm'

/** Ordered tabs — Rules first, so it is the default segment on open. */
export const NC_TAB_ORDER: readonly NcTabKey[] = ['rules', 'targets', 'snooze', 'alarm']

/** The tab shown when the screen first opens. */
export const DEFAULT_NC_TAB: NcTabKey = 'rules'

/** i18n label key for each tab. */
export const NC_TAB_LABEL_KEYS: Readonly<Record<NcTabKey, string>> = {
  rules: 'v2.nc.tabs.rules',
  targets: 'v2.nc.tabs.targets',
  snooze: 'v2.nc.tabs.snooze',
  alarm: 'v2.nc.tabs.alarm',
}

/** The sections THIS caller is offered: Alarm only to a confirmed admin. */
export function ncTabsFor(verdict: AdminVerdict): readonly NcTabKey[] {
  return NC_TAB_ORDER.filter((key) => key !== 'alarm' || verdict === 'admin')
}

/**
 * The section actually shown: a selection the caller is no longer offered (the
 * Alarm section after the hub answered not-admin) falls back to the default,
 * never to a selector with nothing lit.
 */
export function visibleNcTab(selected: NcTabKey, verdict: AdminVerdict): NcTabKey {
  return ncTabsFor(verdict).includes(selected) ? selected : DEFAULT_NC_TAB
}

/** Build the segmented-control options (labels resolved via the passed `t`). */
export function buildNcTabs(
  t: (key: string) => string,
  verdict: AdminVerdict,
): readonly SegmentOption<NcTabKey>[] {
  return ncTabsFor(verdict).map((value) => ({ value, label: t(NC_TAB_LABEL_KEYS[value]) }))
}
