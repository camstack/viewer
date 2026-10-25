/**
 * AccessoryDeviceList — the rows of the camera accessory panel, in view or
 * edit mode, with the local operations wired to the store.
 *
 * Reads `useAccessoryPanel` (the composed rows: hub links + local additions,
 * customised) and hosts the two sheets the edit mode opens — the "add"
 * picker and the icon picker. Nothing here decides what a row is;
 * `accessory-panel-rows.ts` does, and every write is one reducer in
 * `accessory-prefs.ts`.
 *
 * ## No third surface for the rename
 *
 * It used to open `usePrompt`, whose dialog is a `<Modal>` the ROOT
 * `ConfirmProvider` renders — and two of this panel's three hosts are
 * themselves `<Modal>`s, so on iOS the root view controller could not present
 * it over the sheet it was already presenting: nothing drawn, the awaited
 * promise never settled, the interface stuck (operator, 2026-09-23). The
 * rename is now an inline field in the row (`AccessoryRow`), the same
 * mechanism `CamerasManageScreen` uses. The two SHEETS above are unaffected
 * because they render inside this subtree, i.e. inside the presenting modal.
 *
 * The edit mode carries the hint that used to be the prompt's message: the
 * names are local to this app, and an empty field means the hub's name.
 *
 * Loading and empty states are the panel's own: a spinner until the hub's
 * linked list has answered once (a not-yet-known list must never look like
 * an empty one — D315), then the empty sentence, which in edit mode carries
 * the "+" so a camera with nothing linked is exactly where adding starts.
 */
import React, { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Plus } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { useCameras } from '../../../data/use-cameras.js'
import { useAccessoryPanel } from '../../../accessories/use-accessory-panel.js'
import type { AccessoryPanelRow } from '../../../accessories/accessory-panel-rows.js'
import type { AccessoryIconKey } from '../../../accessories/accessory-icon-keys.js'
import { useTimelineScale } from '../theater/TimelineScaleProvider.js'
import { AccessoryRow } from './AccessoryRow.js'
import { AccessoryAddSheet } from './AccessoryAddSheet.js'
import { AccessoryIconSheet } from './AccessoryIconSheet.js'

export interface AccessoryDeviceListProps {
  readonly deviceId: number
  readonly cameraName: string
  readonly editing: boolean
}

interface IconTarget {
  readonly id: number
  readonly label: string
  readonly current: AccessoryIconKey | null
}

export function AccessoryDeviceList({
  deviceId,
  cameraName,
  editing,
}: AccessoryDeviceListProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ui = useTimelineScale()
  const { rows, loading, serverIds, prefs, actions } = useAccessoryPanel(deviceId, editing)
  // The camera's location seeds the picker's suggestions. `includeHidden`: a
  // hidden camera still has a room.
  const { data: cameras = [] } = useCameras({ includeHidden: true })
  const cameraLocation = cameras.find((c) => c.id === deviceId)?.location ?? null
  const [adding, setAdding] = useState(false)
  const [iconTarget, setIconTarget] = useState<IconTarget | null>(null)

  const pickIcon = useCallback(
    (row: AccessoryPanelRow): void => {
      setIconTarget({
        id: row.device.id,
        label: row.label,
        current: prefs.byId[row.device.id]?.icon ?? null,
      })
    },
    [prefs],
  )

  const addRow = editing ? (
    <Pressable
      onPress={() => setAdding(true)}
      accessibilityRole="button"
      accessibilityLabel={t('v2.accessoryPanel.addAction')}
      style={[styles.addRow, { borderColor: colors.borderSubtle }]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.backgroundElevated }]}>
        <Plus size={18} color={colors.primary} />
      </View>
      <Text style={[styles.addLabel, { fontSize: ui.font.sm, color: colors.primary }]} numberOfLines={1}>
        {t('v2.accessoryPanel.addAction')}
      </Text>
    </Pressable>
  ) : null

  const sheets = (
    <>
      {adding ? (
        <AccessoryAddSheet
          deviceId={deviceId}
          cameraName={cameraName}
          cameraLocation={cameraLocation}
          serverIds={serverIds}
          added={prefs.added}
          onSave={actions.setAdditions}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {iconTarget !== null ? (
        <AccessoryIconSheet
          deviceLabel={iconTarget.label}
          current={iconTarget.current}
          onPick={(key) => actions.setIcon(iconTarget.id, key)}
          onClose={() => setIconTarget(null)}
        />
      ) : null}
    </>
  )

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  }

  if (rows.length === 0) {
    return (
      <View style={styles.list}>
        <Text style={[styles.empty, { fontSize: ui.font.sm, color: colors.foregroundSubtle }]}>
          {t('v2.cameraDetail.devicesEmpty')}
        </Text>
        {editing ? null : (
          <Text style={[styles.hint, { fontSize: ui.font.xs, color: colors.foregroundSubtle }]}>
            {t('v2.accessoryPanel.emptyHint')}
          </Text>
        )}
        {addRow}
        {sheets}
      </View>
    )
  }

  return (
    <View style={styles.list}>
      {editing ? (
        <Text style={[styles.editHint, { fontSize: ui.font.xs, color: colors.foregroundSubtle }]}>
          {t('v2.accessoryPanel.renameHint')}
        </Text>
      ) : null}
      {rows.map((row, index) => (
        <AccessoryRow
          key={row.device.id}
          row={row}
          editing={editing}
          first={index === 0}
          last={index === rows.length - 1}
          onRename={(target, name) => actions.rename(target.device.id, name)}
          onPickIcon={pickIcon}
          onMove={(target, delta) => actions.move(target.device.id, delta)}
          onToggleHidden={(target) => actions.setHidden(target.device.id, !target.hidden)}
          onRemove={(target) => actions.remove(target.device.id)}
        />
      ))}
      {addRow}
      {sheets}
    </View>
  )
}

const styles = StyleSheet.create({
  center: { paddingVertical: SPACING.lg, alignItems: 'center' },
  empty: { fontSize: 13, paddingTop: SPACING.md, textAlign: 'center' },
  hint: { fontSize: 11, paddingBottom: SPACING.md, textAlign: 'center' },
  // The edit mode's one sentence, above the rows — left-aligned like the
  // cameras-manage hint it mirrors, not centred like the empty state.
  editHint: { fontSize: 11, lineHeight: 16, paddingBottom: SPACING.xs },
  list: { gap: SPACING.xs },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  addLabel: { fontSize: 14, fontWeight: '600', flex: 1 },
})
