/**
 * CameraAccessoryPanel — ONE composed panel for a camera's companion devices
 * and its function switches, mounted wherever a camera's controls are shown.
 *
 * ## Why one composition
 *
 * Until 2026-09-22 the same bricks were composed twice: the cameras-list
 * sheet (`CameraControlsOverlay`) mounted the devices list AND the function
 * switches (D62), the single-camera page mounted the devices only, and the
 * switches were reachable there through the view-options menu instead. Two
 * compositions of the same bricks drift — this file is the composition, and
 * the three hosts (the cameras-list sheet, the theater's linked-devices
 * panel, the wall's cell overlay) mount it and add nothing.
 *
 * ## What is here
 *
 *  - **Devices**, with a pencil that opens the LOCAL edit mode for every
 *    session: reorder, rename, change icon, hide, add (`AccessoryDeviceList`).
 *    Server-linked devices keep following the hub; local additions are
 *    independent; customisations apply to both. Nothing writes the hub's
 *    link set.
 *  - **Camera functions** (D62): the live `CameraSwitchGroup` for an admin —
 *    it is `admin`-gated by design and this host does not touch that gate —
 *    and, for a non-admin, the `SwitchedOffBadge` that used to sit on the
 *    camera tile, reporting the same fact, silent when nothing is off. An
 *    off switch is REPORTED off; disabled must never look like broken.
 */
import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Check, Pencil } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { hapticTap } from '../../../lib/haptics.js'
import { useIsAdmin } from '../../../data/use-me.js'
import { useSwitchedOffMap } from '../../../data/use-camera-switches.js'
import { CameraSwitchGroup } from '../CameraSwitchGroup.js'
import { SwitchedOffBadge } from '../SwitchedOffBadge.js'
import { AccessoryDeviceList } from './AccessoryDeviceList.js'

export interface CameraAccessoryPanelProps {
  readonly deviceId: number
  /** The camera's display name — the picker's subtitle. A host that cannot
   *  name the camera passes what it has; the panel never invents one. */
  readonly cameraName: string
}

export function CameraAccessoryPanel({ deviceId, cameraName }: CameraAccessoryPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const isAdmin = useIsAdmin()
  const [editing, setEditing] = useState(false)
  // The badge's read, for the non-admin only: an admin's group shares the
  // same cache entry (`cameraSwitchesKey`) and reports the fact itself.
  const switchedOffMap = useSwitchedOffMap(isAdmin ? [] : [deviceId], !isAdmin)
  const switchedOff = switchedOffMap[deviceId] ?? []

  return (
    <View style={styles.panel}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionLabel, { color: colors.foregroundMuted }]}>
          {t('v2.cameraDetail.devices')}
        </Text>
        <Pressable
          onPress={() => {
            hapticTap()
            setEditing((v) => !v)
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={editing ? t('v2.accessoryPanel.done') : t('v2.accessoryPanel.edit')}
          accessibilityState={{ selected: editing }}
          style={[
            styles.editToggle,
            { backgroundColor: editing ? colors.primary : colors.surface },
          ]}
        >
          {editing ? (
            <Check size={16} color={colors.primaryForeground} />
          ) : (
            <Pencil size={16} color={colors.foregroundMuted} />
          )}
        </Pressable>
      </View>
      <AccessoryDeviceList deviceId={deviceId} cameraName={cameraName} editing={editing} />

      {isAdmin ? (
        <CameraSwitchGroup deviceId={deviceId} />
      ) : switchedOff.length > 0 ? (
        <View>
          <Text style={[styles.sectionLabel, { color: colors.foregroundMuted }]}>
            {t('v2.cameraSwitches.title')}
          </Text>
          <View style={styles.switchedOffRow}>
            <SwitchedOffBadge
              switchedOff={switchedOff}
              accessibilityLabel={t('v2.cameraSwitches.badgeLabel', { count: switchedOff.length })}
            />
          </View>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { gap: SPACING.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  editToggle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  switchedOffRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm },
})
