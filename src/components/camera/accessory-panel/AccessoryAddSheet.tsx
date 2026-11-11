/**
 * AccessoryAddSheet — add devices to a camera's accessory panel, LOCALLY.
 *
 * ## What this is, and what it is not
 *
 * This is the viewer's "+" on the accessory panel. What it writes is the
 * operator's LOCAL additions (`accessory-prefs.ts`, in the camera-prefs
 * store) — never the hub's link set. The sheet that used to sit here wrote
 * `_linkedDeviceIds` through `applyDeviceSettingsPatch`; that made the viewer
 * a second authority over a set admin-ui owns, and it is gone. Because the
 * write is local and the catalogue read is a view procedure, the "+" is
 * offered to EVERY session, not only to admins.
 *
 * ## The offer (D356's ordering, kept)
 *
 * The list is the device → value picker (`DeviceValueSheet`, issue #496):
 * `deviceManager.search` with this camera as the context, so same-location
 * devices are SUGGESTED first, then the fleet by type, with search and the
 * Location / Integration / Type facets. A container is never offered, its
 * children are, named after it (the second line says "in <container>").
 * Two things are withheld on top: a device the hub ALREADY links to this
 * camera (it is on the panel; adding it again is a no-op the operator would
 * read as broken), and a device the panel would never draw (no actuating
 * control — an addition that produces nothing is the accept-then-drop branch
 * D391 names). Both are decided on the catalogue: the search is asked only
 * for the TYPES of the offerable devices, and the few of those types that
 * are not offerable are excluded by id.
 *
 * ## A session, like the pencil
 *
 * Opening seeds a DRAFT from the current additions; every tap moves the
 * draft; only ✓ writes. No confirmation on removal: a local addition is
 * reversible with one more tap, unlike the unlink the old sheet confirmed.
 *
 * The sheet itself — keyboard handling (padding on iOS, nothing on
 * Android/web; backdrop tap closes the keyboard before the sheet; no bottom
 * inset paid while the keyboard covers it), frame, header and search row — is
 * `ui/PickerSheet.tsx`, shared with every device field (D636).
 * The operator's report "la tastiera copre la lista" is guarded in
 * `accessory-panel.spec.ts`.
 */
import React, { memo, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { DeviceSearchItem } from '@camstack/types'

import { X } from '../../../lib/icons.js'
import { PickerSheet, PickerSheetButton } from '../../ui/PickerSheet.js'
import { EmptyState, ErrorState } from '../../ui/EmptyState.js'
import { SkeletonBox } from '../../ui/SkeletonBox.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { CONTAINER_DEVICE_TYPE, type PickerCandidate } from '../../../data/linked-device-picker.js'
import { useDeviceCatalogue } from '../../../accessories/use-device-catalogue.js'
import { accessoryActuates } from '../../../accessories/use-accessory-panel.js'
import { DeviceValueSheet } from '../../device-value-picker/DeviceValueSheet.js'
import { deviceIdsOf, pickedDevices } from '../../device-value-picker/picked-devices.js'

export interface AccessoryAddSheetProps {
  readonly deviceId: number
  readonly cameraName: string
  /** Ids the hub already links to this camera: on the panel, not offered. */
  readonly serverIds: readonly number[]
  /** The current local additions — the draft's seed. */
  readonly added: readonly number[]
  readonly onSave: (ids: readonly number[]) => void
  readonly onClose: () => void
}

/** What the search is narrowed to: the offerable devices' types, minus the rest of those types by id. */
export interface AccessoryOffer {
  readonly types: readonly string[]
  readonly excludeIds: readonly number[]
  /** A container child's container name, by id. */
  readonly containerOf: ReadonlyMap<number, string>
}

function offerable(c: PickerCandidate, server: ReadonlySet<number>, cameraId: number): boolean {
  if (c.id === cameraId || server.has(c.id)) return false
  if (c.type === 'camera' || c.type === CONTAINER_DEVICE_TYPE) return false
  return accessoryActuates({ ...c, online: true, features: c.features ?? [], role: null, displayIcon: null })
}

export function accessoryOffer(
  candidates: readonly PickerCandidate[],
  serverIds: readonly number[],
  cameraId: number,
): AccessoryOffer {
  const server = new Set(serverIds)
  const nameById = new Map(candidates.map((c) => [c.id, c.name]))
  const yes = candidates.filter((c) => offerable(c, server, cameraId))
  const types = new Set(yes.map((c) => c.type))
  const yesIds = new Set(yes.map((c) => c.id))
  const containerOf = new Map<number, string>()
  for (const c of yes) {
    const parent = c.parentDeviceId !== null ? nameById.get(c.parentDeviceId) : undefined
    if (parent !== undefined) containerOf.set(c.id, parent)
  }
  return {
    types: [...types],
    excludeIds: candidates.filter((c) => types.has(c.type) && !yesIds.has(c.id)).map((c) => c.id),
    containerOf,
  }
}

export const AccessoryAddSheet = memo(function AccessoryAddSheet({
  deviceId,
  cameraName,
  serverIds,
  added,
  onSave,
  onClose,
}: AccessoryAddSheetProps): React.JSX.Element {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const catalogueQuery = useDeviceCatalogue(true)
  const candidates = catalogueQuery.data ?? null
  const offer = useMemo(
    () => (candidates === null ? null : accessoryOffer(candidates, serverIds, deviceId)),
    [candidates, serverIds, deviceId],
  )
  const value = useMemo(() => pickedDevices(added), [added])

  // Nothing the panel could draw: say so, never ask the fleet unfiltered.
  if (offer === null || offer.types.length === 0) {
    return (
      <PickerSheet
        title={t('v2.accessoryPanel.addTitle')}
        subtitle={cameraName}
        onClose={onClose}
        headerRight={
          <PickerSheetButton onPress={onClose} label={t('v2.accessoryPanel.cancel')}>
            <X size={18} color={colors.foreground} />
          </PickerSheetButton>
        }
      >
        {catalogueQuery.isError ? (
          <ErrorState fill={false} title={t('v2.accessoryPanel.loadFailed')} />
        ) : offer !== null ? (
          <EmptyState fill={false} title={t('v2.accessoryPanel.nothingToAdd')} />
        ) : (
          <View accessibilityState={{ busy: true }} style={styles.loading}>
            <SkeletonBox style={styles.skeleton} />
            <SkeletonBox style={styles.skeleton} />
          </View>
        )}
      </PickerSheet>
    )
  }
  const detailOf = (item: DeviceSearchItem): string | null => {
    const parent = offer.containerOf.get(item.id)
    return parent === undefined ? null : t('v2.deviceValuePicker.inContainer', { name: parent })
  }
  return (
    <DeviceValueSheet
      title={t('v2.accessoryPanel.addTitle')}
      subtitle={cameraName}
      kind="device"
      multiple
      contextDeviceId={deviceId}
      fixedTypes={offer.types}
      excludeIds={offer.excludeIds}
      recentKey="accessory-add"
      detailOf={detailOf}
      value={value}
      onChange={(next) => onSave(deviceIdsOf(next))}
      onClose={onClose}
    />
  )
})

const styles = StyleSheet.create({
  loading: { gap: SPACING.md, padding: SPACING.lg },
  skeleton: { height: 44 },
})
