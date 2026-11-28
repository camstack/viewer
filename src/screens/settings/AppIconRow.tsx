/**
 * Settings → App → General: "App icon". The row shows the active launcher icon
 * (thumbnail + name); a tap opens a sheet with the ten alternates and the
 * default, and a pick applies at once — a live device control, nothing to
 * save. Absent when this device cannot switch its icon (the web).
 */
import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useTranslation } from 'react-i18next'

import { PickerSheet, PickerSheetButton } from '../../components/ui/PickerSheet.js'
import { useNotice } from '../../components/ui/confirm.js'
import { Row } from '../../components/ui/Row.js'
import { hapticTap } from '../../lib/haptics.js'
import { Check, X } from '../../lib/icons.js'
import { APP_ICON_IDS, canChangeAppIcon, getAppIcon, setAppIcon, type AppIconId } from '../../lib/app-icon.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { APP_ICON_THUMBS, DEFAULT_ICON_THUMB } from './app-icon-thumbs.js'

const THUMB_SMALL = 28
const THUMB_GRID = 64

export interface AppIconRowProps {
  /** Hide the row's bottom hairline (last row of its card). */
  readonly last?: boolean
}

export function AppIconRow({ last }: AppIconRowProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const notice = useNotice()
  const [current, setCurrent] = useState<AppIconId | null>(() => getAppIcon())
  const [open, setOpen] = useState(false)

  if (!canChangeAppIcon()) return null

  const nameOf = (icon: AppIconId | null): string =>
    icon === null ? t('v2.settings.appIconDefault') : t(`v2.settings.appIconNames.${icon}`)

  const pick = (icon: AppIconId | null): void => {
    hapticTap()
    setOpen(false)
    setAppIcon(icon).then(
      (active) => setCurrent(active),
      (err: unknown) => {
        notice({ title: t('v2.settings.appIcon'), message: err instanceof Error ? err.message : String(err) })
      },
    )
  }

  const choices: readonly (AppIconId | null)[] = [null, ...APP_ICON_IDS]

  return (
    <>
      <Row
        label={t('v2.settings.appIcon')}
        right={
          <View style={styles.current}>
            <Image
              source={current === null ? DEFAULT_ICON_THUMB : APP_ICON_THUMBS[current]}
              style={[styles.thumbSmall, { borderColor: colors.border }]}
              testID="app-icon-current"
            />
            <Text style={{ color: colors.foregroundMuted, fontSize: 14 }}>{nameOf(current)}</Text>
          </View>
        }
        onPress={() => setOpen(true)}
        last={last}
      />
      {open ? (
        <PickerSheet
          title={t('v2.settings.appIconPickTitle')}
          onClose={() => setOpen(false)}
          testID="app-icon-sheet"
          headerRight={
            <PickerSheetButton label={t('v2.common.close')} onPress={() => setOpen(false)}>
              <X size={18} color={colors.foreground} />
            </PickerSheetButton>
          }
        >
          <View style={styles.grid}>
            {choices.map((icon) => {
              const selected = icon === current
              return (
                <Pressable
                  key={icon ?? 'default'}
                  testID={`app-icon-option-${icon ?? 'default'}`}
                  onPress={() => pick(icon)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={styles.cell}
                >
                  <View style={[styles.thumbWrap, { borderColor: selected ? colors.primary : colors.border }]}>
                    <Image source={icon === null ? DEFAULT_ICON_THUMB : APP_ICON_THUMBS[icon]} style={styles.thumbGrid} />
                    {selected ? (
                      <View style={[styles.check, { backgroundColor: colors.primary }]}>
                        <Check size={12} color={colors.primaryForeground} />
                      </View>
                    ) : null}
                  </View>
                  <Text numberOfLines={1} style={[styles.name, { color: selected ? colors.foreground : colors.foregroundMuted }]}>
                    {nameOf(icon)}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </PickerSheet>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  current: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  thumbSmall: { width: THUMB_SMALL, height: THUMB_SMALL, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, gap: SPACING.lg },
  cell: { width: THUMB_GRID + SPACING.lg, alignItems: 'center', gap: SPACING.sm },
  thumbWrap: { borderWidth: 2, borderRadius: RADIUS.lg, padding: 2 },
  thumbGrid: { width: THUMB_GRID, height: THUMB_GRID, borderRadius: RADIUS.md },
  check: { position: 'absolute', right: -4, top: -4, width: 20, height: 20, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 12 },
})
