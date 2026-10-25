/**
 * One line of the subject list: colour chip (the stroke), review badge, class,
 * label, source glyph. A removed proposal is a ghost row (struck through, danger
 * chip) and is not selectable. On the web a hovered row emphasises its box.
 */
import React, { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Badge } from '../../../components/ui/Badge.js'
import { originalClassText } from '../../../retrain/class-picker.js'
import { boxLook } from '../../../retrain/box-look.js'
import type { SubjectRow } from '../../../retrain/rows.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../../theme/tokens.js'
import { RetrainSourceIcon } from './RetrainSourceIcon.js'

/** Wide enough for the longest review badge, so the class column lines up. */
const BADGE_COLUMN = 104

export interface RetrainSubjectRowProps {
  readonly row: SubjectRow
  readonly selected: boolean
  readonly onPress: (key: string) => void
  readonly onHover: (key: string | null) => void
}

export const RetrainSubjectRowView = memo(function RetrainSubjectRowView({
  row,
  selected,
  onPress,
  onHover,
}: RetrainSubjectRowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const removed = row.type === 'removed'
  const kind = removed ? 'removed' : row.diff.kind
  const look = boxLook(kind)
  const macro = removed ? row.ghost.label : row.box.macroClass
  const label = removed ? undefined : row.box.label
  const source = removed ? row.ghost.source : row.box.source
  const approximate = removed ? row.ghost.approximate : row.diff.approximate
  const className = removed
    ? macro
    : t(`v2.retrain.class.${row.box.macroClass}`, row.box.macroClass)
  const was = removed
    ? null
    : originalClassText({
        diff: row.diff,
        macroClass: row.box.macroClass,
        label: row.box.label,
        macroName: (m) => t(`v2.retrain.class.${m}`, m),
      })
  return (
    <Pressable
      testID={`retrain-row-${row.key}`}
      onPress={removed ? undefined : () => onPress(row.key)}
      onHoverIn={() => onHover(row.key)}
      onHoverOut={() => onHover(null)}
      disabled={removed}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: removed }}
      style={[
        styles.row,
        {
          backgroundColor: selected ? colors.surfaceHover : 'transparent',
          borderColor: selected ? colors[look.stroke] : 'transparent',
        },
      ]}
    >
      <View style={[styles.chip, { backgroundColor: colors[look.stroke] }]} />
      <View style={styles.badge}>
        <Badge
          label={`${approximate ? '≈' : ''}${t(look.translationKey, look.fallback)}`}
          tone={look.tone}
          look={look.badgeLook}
          dashed={look.badgeLook === 'outline' || approximate}
          size="sm"
        />
      </View>
      <View style={styles.text}>
        {was !== null ? (
          <Text
            numberOfLines={1}
            style={[styles.class, { color: colors.foreground }]}
            testID="retrain-row-was"
          >
            <Text style={[styles.struck, { color: colors.foregroundMuted }]}>{was.original}</Text>
            {' → '}
            {was.current}
          </Text>
        ) : (
          <Text
            numberOfLines={1}
            style={[
              styles.class,
              { color: removed ? colors.foregroundMuted : colors.foreground },
              removed ? styles.struck : null,
            ]}
          >
            {className}
          </Text>
        )}
        {was === null && label !== undefined && label !== '' ? (
          <Text numberOfLines={1} style={[styles.label, { color: colors.foregroundMuted }]}>
            {label}
          </Text>
        ) : null}
      </View>
      <RetrainSourceIcon source={source} size={14} color={colors.foregroundMuted} />
    </Pressable>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    minHeight: 44,
    paddingHorizontal: SPACING.lg,
    borderLeftWidth: 3,
    borderRadius: RADIUS.sm,
  },
  chip: { width: 10, height: 10, borderRadius: 2 },
  badge: { width: BADGE_COLUMN, justifyContent: 'center' },
  text: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  class: { fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.medium },
  struck: { textDecorationLine: 'line-through' },
  label: { flexShrink: 1, fontSize: TYPOGRAPHY.size.sm },
})
