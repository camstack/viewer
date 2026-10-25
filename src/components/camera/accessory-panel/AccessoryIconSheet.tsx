/**
 * AccessoryIconSheet — pick a local icon for one accessory row.
 *
 * A grid of every glyph the viewer can draw, the current pick marked, and a
 * "default" tile that CLEARS the local pick so the precedence falls back to
 * the admin's override, the role or the type. One tap writes and closes: the
 * pick is local and reversible, so a draft would be ceremony.
 *
 * The vocabulary is the whole icon catalog (D854, ~1,700 icons), drawn in its
 * SECTIONS (primary category) and virtualised by row, over a search row that
 * narrows them (`searchIcons`: key, tags, Italian and English words) — the same search idiom as the sibling
 * `AccessoryAddSheet` (its keyboard handling too: padding on iOS, backdrop tap
 * closes the keyboard before the sheet, no bottom inset paid under it).
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  FlatList,
  Keyboard,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { iconCategoryLabel } from '@camstack/types/client'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Search, X } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { SheetModal } from '../../ui/SheetModal.js'
import { hapticTap } from '../../../lib/haptics.js'
import type { AccessoryIconKey } from '../../../accessories/accessory-icon-keys.js'
import { CatalogIcon } from '../../CatalogIcon.js'
import { iconListRows, iconSections, type IconListRow } from './icon-picker-model.js'

export interface AccessoryIconSheetProps {
  readonly deviceLabel: string
  /** The operator's CURRENT local pick, or null when none (the row wears an
   *  inherited glyph). */
  readonly current: AccessoryIconKey | null
  readonly onPick: (key: AccessoryIconKey | null) => void
  readonly onClose: () => void
}

const TILE = 56

function rowKey(row: IconListRow): string {
  return row.id
}

export const AccessoryIconSheet = memo(function AccessoryIconSheet({
  deviceLabel,
  current,
  onPick,
  onClose,
}: AccessoryIconSheetProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState('')
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

  const [width, setWidth] = useState(0)
  const columns = Math.max(1, Math.floor((width + SPACING.sm) / (TILE + SPACING.sm)))
  const rows = useMemo(() => iconListRows(iconSections(query), columns), [query, columns])
  const onBodyLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width - SPACING.lg * 2)
  }, [])

  const choose = (key: AccessoryIconKey | null): void => {
    hapticTap()
    onPick(key)
    onClose()
  }

  return (
    <SheetModal
      visible
      onClose={onClose}
      // ui-check-ok: modal scrim; no scrim token in tokens.ts yet (pre-existing)
      scrimColor="#00000088"
      onBackdropPress={() => {
        if (keyboardUp) {
          Keyboard.dismiss()
          return
        }
        onClose()
      }}
      backdropLabel={t('v2.common.close')}
      sheetStyle={[
        styles.sheet,
        {
          backgroundColor: colors.backgroundElevated,
          paddingBottom: (keyboardUp ? 0 : insets.bottom) + SPACING.md,
        },
      ]}
    >
      <View style={styles.header}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
          {t('v2.accessoryPanel.iconTitle', { device: deviceLabel })}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('v2.common.close')}
          style={[styles.iconBtn, { backgroundColor: colors.surface }]}
        >
          <X size={18} color={colors.foreground} />
        </Pressable>
      </View>

      <View style={[styles.searchRow, { backgroundColor: colors.surface }]}>
        <Search size={14} color={colors.foregroundMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          placeholder={t('v2.accessoryPanel.iconSearchPlaceholder')}
          placeholderTextColor={colors.foregroundSubtle}
          accessibilityLabel={t('v2.accessoryPanel.iconSearchPlaceholder')}
          style={[styles.searchInput, { color: colors.foreground }]}
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={rowKey}
        onLayout={onBodyLayout}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        initialNumToRender={8}
        windowSize={5}
        ListHeaderComponent={
          /* Clearing the pick is never filtered away: a search that hid it
             would strand the operator on a glyph they cannot undo. */
          <Pressable
            onPress={() => choose(null)}
            accessibilityRole="button"
            accessibilityLabel={t('v2.accessoryPanel.iconDefault')}
            accessibilityState={{ selected: current === null }}
            style={[
              styles.tile,
              styles.defaultTile,
              { borderColor: current === null ? colors.primary : colors.border },
            ]}
          >
            <Text style={[styles.defaultLabel, { color: colors.foregroundMuted }]} numberOfLines={2}>
              {t('v2.accessoryPanel.iconDefault')}
            </Text>
          </Pressable>
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.foregroundMuted }]}>
            {t('v2.accessoryPanel.noMatches')}
          </Text>
        }
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <Text style={[styles.sectionTitle, { color: colors.foregroundMuted }]}>
              {t(`v2.accessoryPanel.iconCategories.${item.category}`, {
                defaultValue: iconCategoryLabel(item.category),
              })}
            </Text>
          ) : (
            <View style={styles.grid}>
              {item.keys.map((key) => {
                const selected = key === current
                return (
                  <Pressable
                    key={key}
                    onPress={() => choose(key)}
                    accessibilityRole="button"
                    accessibilityLabel={key}
                    accessibilityState={{ selected }}
                    style={[
                      styles.tile,
                      {
                        backgroundColor: selected ? colors.primary : colors.surface,
                        borderColor: selected ? colors.primary : colors.borderSubtle,
                      },
                    ]}
                  >
                    <CatalogIcon
                      iconKey={key}
                      size={22}
                      color={selected ? colors.primaryForeground : colors.foreground}
                    />
                  </Pressable>
                )
              })}
            </View>
          )
        }
      />
    </SheetModal>
  )
})

const styles = StyleSheet.create({
  body: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl, gap: SPACING.sm },
  defaultLabel: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  defaultTile: { width: TILE * 2 + SPACING.sm, borderStyle: 'dashed', paddingHorizontal: SPACING.xs },
  empty: { fontSize: 14, paddingVertical: SPACING.xl, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: SPACING.sm },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingTop: SPACING.sm,
  },
  sheet: { maxHeight: '92%', borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl },
  title: { flex: 1, fontSize: 16, fontWeight: '700' },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
