/**
 * The info button at the top-right of a device's detail header. A tap opens
 * an anchored popover of read-only facts (provider, type, id, …). The menu is
 * the kit's {@link AnchoredMenu}: a phone has no hover, and a raw modal would
 * be a second sheet.
 */
import React, { useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AnchoredMenu } from '../components/ui/AnchoredMenu.js'
import type { AnchorRect } from '../components/ui/dropdown-placement.js'
import { SheetIconButton } from '../components/ui/SheetHeader.js'
import { useDeviceIdentity } from '../data/device-detail-status.js'
import { useDeviceProviderLabel } from '../data/device-provider-label.js'
import type { Translate } from '../data/export-format.js'
import { Info } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY } from '../theme/tokens.js'
import { deviceInfoFacts, type DeviceInfoFact } from './device-info-facts.js'

export interface DeviceInfoButtonProps {
  readonly deviceId: number
}

/** Height of one fact row, for placing the menu before it is measured. */
const ROW_ESTIMATE = 36

function useDeviceInfoFacts(deviceId: number, t: Translate): readonly DeviceInfoFact[] {
  const identity = useDeviceIdentity(deviceId).data ?? null
  const parent = useDeviceIdentity(identity?.parentDeviceId ?? null).data ?? null
  const provider = useDeviceProviderLabel(identity?.provider ?? null)
  return deviceInfoFacts(
    {
      provider,
      typeId: identity?.type ?? null,
      roleId: identity?.role ?? null,
      deviceId,
      parentName: parent?.name ?? null,
      reachability: identity?.reachability ?? 'unknown',
      seenAt: identity?.seenAt ?? null,
      nowMs: Date.now(),
    },
    t,
  )
}

export function DeviceInfoButton({ deviceId }: DeviceInfoButtonProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const anchorRef = useRef<View>(null)
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)
  const [open, setOpen] = useState(false)
  const translate: Translate = (key, opts) => t(key, opts)
  const facts = useDeviceInfoFacts(deviceId, translate)

  const openMenu = (): void => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height })
      setOpen(true)
    })
  }

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <SheetIconButton
          icon={Info}
          label={t('v2.deviceInfo.open')}
          onPress={openMenu}
          testID="device-info-button"
        />
      </View>
      <AnchoredMenu
        visible={open}
        onRequestClose={() => setOpen(false)}
        anchor={anchor}
        align="end"
        minWidth={260}
        estimatedHeight={facts.length * ROW_ESTIMATE + SPACING.md}
        preferredPlacement="below"
      >
        <View testID="device-info-popover" style={styles.list}>
          {facts.map((fact) => (
            <View key={fact.labelKey} style={styles.row}>
              <Text style={[styles.label, { color: colors.foregroundMuted }]}>{t(fact.labelKey)}</Text>
              <Text style={[styles.value, { color: colors.foreground }]}>{fact.value}</Text>
            </View>
          ))}
        </View>
      </AnchoredMenu>
    </>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: SPACING.sm },
  row: { gap: 2 },
  label: { fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.medium },
  value: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.medium },
})
