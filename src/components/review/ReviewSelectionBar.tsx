/**
 * ReviewSelectionBar — the bar under the filters while a review grid (People,
 * Plates) is in multi-select mode. Three writes, none a variant of another:
 *
 *   • **Assign** opens the detail modal over the whole selection — one target
 *     for every selected item.
 *   • **Apply suggestions** puts each selected item on ITS OWN suggested target.
 *   • **Delete** removes the selected items for good.
 *
 * The two conditional actions follow one discipline: offered only when the
 * whole selection qualifies, and when it does not the button is disabled AND
 * the bar says how many items are the reason — each action states its own
 * reason. Every button says what it does in WORDS beside its icon — an
 * unlabelled bin next to two labelled buttons read as a different kind of
 * control. The strings come in from the page (`FaceReviewSelectionBar` and
 * `PlateReviewSelectionBar` map their own keys); the layout is shared.
 */
import React, { memo } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS, withAlpha } from '../../theme/tokens.js'
import { Tag, Trash2, UserCheck, X } from '../../lib/icons.js'

export interface ReviewSelectionBarProps {
  readonly selectedCount: number
  readonly countLabel: string
  readonly cancelLabel: string
  readonly assignLabel: string
  readonly deleteLabel: string
  readonly applyLabel: string
  /** Apply is offered: every selected item carries a suggestion. */
  readonly applyReady: boolean
  /** Why Apply is disabled, or `null` while it is offered / nothing is selected. */
  readonly applyReason: string | null
  /** Delete is offered: the whole selection may be removed. */
  readonly deleteReady: boolean
  readonly deleteReason: string | null
  readonly onCancel: () => void
  readonly onAssign: () => void
  readonly onApplySuggestions: () => void
  readonly onDelete: () => void
}

export const ReviewSelectionBar = memo(function ReviewSelectionBar({
  selectedCount,
  countLabel,
  cancelLabel,
  assignLabel,
  deleteLabel,
  applyLabel,
  applyReady,
  applyReason,
  deleteReady,
  deleteReason,
  onCancel,
  onAssign,
  onApplySuggestions,
  onDelete,
}: ReviewSelectionBarProps) {
  const { colors } = useTheme()

  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.topRow}>
        <Text style={[styles.count, { color: colors.foreground }]}>{countLabel}</Text>
        <Pressable onPress={onCancel} accessibilityRole="button" style={styles.cancel}>
          <X size={14} color={colors.foregroundMuted} />
          <Text style={[styles.cancelText, { color: colors.foregroundMuted }]}>{cancelLabel}</Text>
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onApplySuggestions}
          disabled={!applyReady}
          accessibilityRole="button"
          accessibilityState={{ disabled: !applyReady }}
          accessibilityHint={applyReason ?? undefined}
          style={[
            styles.applyBtn,
            {
              borderColor: colors.primary,
              backgroundColor: withAlpha(colors.primary, 0.1),
              opacity: applyReady ? 1 : 0.5,
            },
          ]}
        >
          <UserCheck size={14} color={colors.primary} />
          <Text numberOfLines={1} style={[styles.applyText, { color: colors.primary }]}>
            {applyLabel}
          </Text>
        </Pressable>

        <Pressable
          onPress={onDelete}
          disabled={!deleteReady}
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
          accessibilityState={{ disabled: !deleteReady }}
          accessibilityHint={deleteReason ?? undefined}
          style={[styles.deleteBtn, { borderColor: colors.danger, opacity: deleteReady ? 1 : 0.5 }]}
        >
          <Trash2 size={14} color={colors.danger} />
          <Text numberOfLines={1} style={[styles.applyText, { color: colors.danger }]}>
            {deleteLabel}
          </Text>
        </Pressable>

        <Pressable
          onPress={onAssign}
          disabled={selectedCount === 0}
          accessibilityRole="button"
          accessibilityState={{ disabled: selectedCount === 0 }}
          style={[styles.assignBtn, { backgroundColor: colors.primary, opacity: selectedCount === 0 ? 0.5 : 1 }]}
        >
          <Tag size={14} color={colors.primaryForeground} />
          <Text style={[styles.assignText, { color: colors.primaryForeground }]}>{assignLabel}</Text>
        </Pressable>
      </View>

      {applyReason !== null ? (
        <Text style={[styles.reason, { color: colors.foregroundMuted }]}>{applyReason}</Text>
      ) : null}
      {deleteReason !== null ? (
        <Text style={[styles.reason, { color: colors.foregroundMuted }]}>{deleteReason}</Text>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  bar: {
    gap: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  count: { fontSize: 13, fontWeight: '700', flex: 1 },
  cancel: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs },
  cancelText: { fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  applyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  applyText: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  deleteBtn: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  assignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  assignText: { fontSize: 13, fontWeight: '700' },
  reason: { fontSize: 11 },
})
