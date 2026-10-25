/**
 * PickerSheet — the bottom sheet a picker opens: a title, the header's own
 * buttons, a search row, and the list.
 *
 * Extracted from the accessory panel's "add" sheet (`AccessoryAddSheet`) so the
 * notification device picker (`DevicePicker`, D636) opens the SAME sheet
 * rather than a copy of it. What it owns is exactly what both need and what
 * was hard to get right once:
 *
 *  - keyboard handling: padding on iOS, nothing on Android/web; a backdrop tap
 *    closes the keyboard before the sheet; no bottom inset paid while the
 *    keyboard covers it (the operator's "la tastiera copre la lista", guarded
 *    in `accessory-panel.spec.ts`);
 *  - the frame: the sheet's height cap, its rounded top, the header row — in
 *    the shared `SheetModal`, so on the web it opens as a centred dialog.
 *
 * What it does not own: what the list is, what a row does, when to save. Those
 * stay with the caller, which renders them as `children`.
 */
import React, { useEffect, useState } from 'react'
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Search } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { SheetModal } from './SheetModal.js'

/** The search row, when the sheet has one. */
export interface PickerSheetSearch {
  readonly value: string
  readonly onChange: (next: string) => void
  readonly placeholder: string
}

export interface PickerSheetProps {
  readonly title: string
  readonly subtitle?: string
  /** Called by a backdrop tap (once the keyboard is down) and the back gesture. */
  readonly onClose: () => void
  /** The header's buttons — close, save, done: the caller's to decide. */
  readonly headerRight: React.ReactNode
  /** Absent while there is nothing to search (loading, failed). */
  readonly search?: PickerSheetSearch
  readonly children: React.ReactNode
  readonly testID?: string
}

export function PickerSheet({
  title,
  subtitle,
  onClose,
  headerRight,
  search,
  children,
  testID,
}: PickerSheetProps): React.JSX.Element {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const [keyboardUp, setKeyboardUp] = useState(false)

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardUp(true)
    })
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardUp(false)
    })
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])

  return (
    <SheetModal
      visible
      onClose={onClose}
      // ui-check-ok: modal scrim; no scrim token in tokens.ts yet (pre-existing)
      scrimColor="#00000088"
      backdropLabel={t('v2.common.close')}
      onBackdropPress={() => {
        if (keyboardUp) {
          Keyboard.dismiss()
          return
        }
        onClose()
      }}
      testID={testID}
      sheetStyle={[
        styles.sheet,
        {
          backgroundColor: colors.backgroundElevated,
          paddingBottom: (keyboardUp ? 0 : insets.bottom) + SPACING.md,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
            {title}
          </Text>
          {subtitle !== undefined ? (
            <Text numberOfLines={1} style={[styles.subtitle, { color: colors.foregroundMuted }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {headerRight}
      </View>
      {search !== undefined ? (
        <View style={[styles.searchRow, { backgroundColor: colors.surface }]}>
          <Search size={14} color={colors.foregroundMuted} />
          <TextInput
            value={search.value}
            onChangeText={search.onChange}
            autoCorrect={false}
            placeholder={search.placeholder}
            placeholderTextColor={colors.foregroundSubtle}
            accessibilityLabel={search.placeholder}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
        </View>
      ) : null}
      {children}
    </SheetModal>
  )
}

/** The round header button both sheets use (close, save, done). */
export interface PickerSheetButtonProps {
  readonly onPress: () => void
  readonly label: string
  readonly primary?: boolean
  readonly disabled?: boolean
  readonly children: React.ReactNode
}

export function PickerSheetButton({
  onPress,
  label,
  primary = false,
  disabled = false,
  children,
}: PickerSheetButtonProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.iconBtn,
        {
          backgroundColor: primary ? colors.primary : colors.surface,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  headerText: { flex: 1 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: SPACING.sm },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
  },
  sheet: { maxHeight: '92%', borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl },
  subtitle: { fontSize: 12 },
  title: { fontSize: 16, fontWeight: '700' },
})
