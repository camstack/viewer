/**
 * ZoneMultiSelect — the multi-select zone picker, by NAME — `camera:zone`,
 * like the rule editor's zone scope (operator, 2026-10-01), so two cameras'
 * "Front door" are told apart. Used by the digest editor.
 *
 * Replaces the free-text tag input that made the operator type raw zone ids.
 * Zones come from the rule's selected cameras (`useCameraZoneLists`); a
 * selected id the list does not know stays
 * visible as a warning chip — removable, never silently dropped (see
 * `zone-choices.ts` for why).
 *
 * Mirrors the admin UI's picker semantics and `OccupancyField`'s loading /
 * empty hints, so the two editors read the same (D-parity, phase 0 of
 * docs/design/2026-08-19-viewer-notification-rule-parity.md).
 */

import React, { useMemo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { zoneMultiChoices, zonePickerItems } from '../../data/zone-choices.js'
import { useCameraZoneLists } from '../../data/use-zones.js'
import { useCameras } from '../../data/use-cameras.js'
import { hapticTap } from '../../lib/haptics.js'
import { X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'

interface ZoneMultiSelectProps {
  /** The rule's selected cameras — the zones offered are their union. */
  readonly deviceIds: readonly number[]
  readonly value: readonly string[]
  readonly onChange: (next: string[]) => void
}

export function ZoneMultiSelect({ deviceIds, value, onChange }: ZoneMultiSelectProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const zonesQuery = useCameraZoneLists(deviceIds, true)
  const cameras = useCameras({ includeHidden: true })
  const zones = useMemo(
    () =>
      zonePickerItems(
        zonesQuery.data ?? [],
        new Map((cameras.data ?? []).map((cam) => [cam.id, cam.name])),
      ),
    [zonesQuery.data, cameras.data],
  )
  const { options, unknownIds } = zoneMultiChoices(zones, value)

  const toggle = (id: string, on: boolean): void => {
    hapticTap()
    onChange(on ? value.filter((v) => v !== id) : [...value, id])
  }

  const hint =
    deviceIds.length === 0
      ? t('v2.nc.rules.editor.zonePicker.needCamera')
      : zonesQuery.isLoading
        ? t('v2.nc.rules.editor.zonePicker.loading')
        : options.length === 0 && unknownIds.length === 0
          ? t('v2.nc.rules.editor.zonePicker.none')
          : null

  return (
    <View style={{ gap: SPACING.sm }}>
      {hint !== null ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{hint}</Text>
      ) : null}
      {options.length > 0 || unknownIds.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
          {options.map((option) => (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: option.selected }}
              onPress={() => toggle(option.id, option.selected)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SPACING.xs,
                borderRadius: RADIUS.md,
                paddingVertical: SPACING.xs,
                paddingHorizontal: SPACING.sm,
                borderWidth: 1,
                borderColor: option.selected ? colors.primary : colors.border,
                backgroundColor: option.selected ? `${colors.primary}1f` : colors.background,
              }}
            >
              <Text
                style={{
                  color: option.selected ? colors.primary : colors.foreground,
                  fontSize: 13,
                }}
              >
                {option.name}
              </Text>
              {option.selected ? <X size={12} color={colors.primary} /> : null}
            </Pressable>
          ))}
          {unknownIds.map((id) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityState={{ selected: true }}
              accessibilityLabel={t('v2.nc.rules.editor.zonePicker.missing', { id })}
              onPress={() => toggle(id, true)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SPACING.xs,
                borderRadius: RADIUS.md,
                paddingVertical: SPACING.xs,
                paddingHorizontal: SPACING.sm,
                borderWidth: 1,
                borderColor: colors.warning,
              }}
            >
              <Text style={{ color: colors.warning, fontSize: 13 }}>{id}</Text>
              <X size={12} color={colors.warning} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}
