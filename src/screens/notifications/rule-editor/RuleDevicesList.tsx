/**
 * RuleDevicesList — the overview's "active devices", under the Devices row of
 * the rule summary. ALWAYS open (operator, 2026-10-01: "no show more — always
 * show all devices, the section exists for this"); it used to be a collapsed
 * toggle.
 *
 * It says the rule's device scope in its ACTIVE mode (`summaryDeviceList`):
 * Only these → those devices; All except these → "All devices except N" and
 * the excluded ones; All → "All devices" and nothing is read.
 *
 * The names come from a TARGETED read of just those ids (`useDevicesByIds`,
 * the device catalogue's slim rows) — never the fleet. An id is called removed
 * only when that read ANSWERED without it; pending or failed, it is
 * "Device #id" (D315). Nothing is dropped from the list (D49).
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { useDevicesByIds } from '../../../data/use-devices-by-ids.js'
import {
  deviceListStateOf,
  resolveSelectedDevices,
  type SelectedDeviceRow,
} from '../../../components/notifications/device-selection.js'
import type { RuleScopeDraft } from '../../../components/notifications/rule-scope-model.js'
import { summaryDeviceList } from '../../../components/notifications/rule-summary-lines.js'

const LIST = 'v2.nc.rules.summary.deviceList'
const EDITOR = 'v2.nc.rules.editor'

export interface RuleDevicesListProps {
  /** The draft's device scope — what the rule runs on once saved. */
  readonly scope: RuleScopeDraft<number>
  /** Draw a hairline above the list (it follows another row). */
  readonly divided?: boolean
}

export function RuleDevicesList({ scope, divided = false }: RuleDevicesListProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const list = summaryDeviceList(scope)
  const lookup = useDevicesByIds([...list.listed, ...list.excluded])
  const state = deviceListStateOf(lookup)

  const label = (row: SelectedDeviceRow): string =>
    row.name ?? (row.removed ? t(`${EDITOR}.deviceRemoved`, { id: row.id }) : t(`${EDITOR}.deviceUnknown`, { id: row.id }))

  const rows = (group: 'listed' | 'excluded', from: readonly number[]): React.ReactNode =>
    resolveSelectedDevices(from, lookup.data, state).map((row) => (
      <Text
        key={`${group}-${String(row.id)}`}
        testID={`rule-devices-row-${String(row.id)}`}
        style={{ color: row.removed ? colors.warning : colors.foreground, fontSize: 13, lineHeight: 18 }}
      >
        {label(row)}
      </Text>
    ))

  return (
    <View
      testID="rule-devices-list"
      style={{
        borderTopWidth: divided ? 1 : 0,
        borderTopColor: colors.border,
        gap: SPACING.xs,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.md,
      }}
    >
      <Text style={{ color: colors.foregroundSubtle, fontSize: 12, fontWeight: '600' }}>
        {t(list.headline.key, list.headline.params)}
      </Text>
      {rows('listed', list.listed)}
      {list.mode === 'only' && list.excluded.length > 0 ? (
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12, fontWeight: '600', marginTop: SPACING.xs }}>
          {t(`${LIST}.excludedTitle`)}
        </Text>
      ) : null}
      {rows('excluded', list.excluded)}
    </View>
  )
}
