import React from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal, Settings2, ListOrdered, ListFilter, X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { useBottomNavInset } from '../../navigation/bottom-nav-inset.js'
import { GlassSurface } from '../ui/GlassSurface.js'
import type { ReelFilterCondition } from '../../store/reel-filter-store.js'
import { REEL_FILTER_DOT_TEST_ID } from '../events/track/reel-layout.js'

export interface CamerasFabProps {
  readonly open: boolean
  readonly onToggle: () => void
  readonly onClose: () => void
  readonly onAppearance: () => void
  readonly onEditList: () => void
  readonly reelCondition: ReelFilterCondition
  readonly onReelFilter: () => void
}

export function CamerasFab({
  open,
  onToggle,
  onClose,
  onAppearance,
  onEditList,
  reelCondition,
  onReelFilter,
}: CamerasFabProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const navInset = useBottomNavInset()
  const reelNarrowed = reelCondition.kind !== 'all'
  const reelSuffix =
    reelCondition.kind === 'all'
      ? t('v2.events.all', 'All')
      : reelCondition.kind === 'default'
        ? t('v2.cameras.reelFilterDefaultTag', 'Detections')
        : t('v2.cameras.reelFilterCountTag', '{{count}} types', { count: reelCondition.count })

  const menuItems = [
    {
      key: 'appearance',
      icon: SlidersHorizontal,
      label: t('v2.cameras.appearance'),
      onPress: onAppearance,
    },
    {
      key: 'reel',
      icon: ListFilter,
      label: reelSuffix,
      onPress: onReelFilter,
    },
    {
      key: 'edit',
      icon: ListOrdered,
      label: t('v2.cameras.editList'),
      onPress: onEditList,
    },
  ] as const

  const fabBottom = SPACING.lg + navInset
  return (
    <>
      {open ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {open ? (
          <View
            style={[styles.menuAnchor, { right: SPACING.lg, bottom: fabBottom + FAB_SIZE + SPACING.sm }]}
            pointerEvents="box-none"
          >
            {/* radius xl — not pill; a pill on a short column reads as an oval. */}
            <GlassSurface variant="bar" radius={RADIUS.xl} contentStyle={styles.menuSurface}>
              {menuItems.map(({ key, icon: Icon, label, onPress }) => (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  onPress={onPress}
                  style={styles.menuRow}
                >
                  <Text numberOfLines={1} style={[styles.menuLabel, { color: colors.foreground }]}>
                    {label}
                  </Text>
                  <View style={[styles.iconSlot, { backgroundColor: colors.surface }]}>
                    <Icon size={18} color={colors.foreground} />
                  </View>
                </Pressable>
              ))}
            </GlassSurface>
          </View>
        ) : null}
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={t('v2.cameras.listOptions')}
          accessibilityState={{ expanded: open }}
          style={[styles.fab, { backgroundColor: colors.primary, right: SPACING.lg, bottom: fabBottom }]}
        >
          {open ? (
            <X size={24} color={colors.primaryForeground} />
          ) : (
            <Settings2 size={24} color={colors.primaryForeground} />
          )}
          {!open && reelNarrowed ? (
            <View
              testID={REEL_FILTER_DOT_TEST_ID}
              style={[styles.fabDot, { backgroundColor: colors.primaryForeground }]}
            />
          ) : null}
        </Pressable>
      </View>
    </>
  )
}

const FAB_SIZE = 56
const ICON_SLOT = 36

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  menuAnchor: {
    position: 'absolute',
    alignItems: 'flex-end',
  },
  fabDot: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  menuSurface: {
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    gap: SPACING.xs,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: SPACING.md,
    paddingVertical: SPACING.xs,
    paddingLeft: SPACING.md,
    minHeight: ICON_SLOT,
  },
  menuLabel: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  iconSlot: {
    width: ICON_SLOT,
    height: ICON_SLOT,
    borderRadius: ICON_SLOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
})
