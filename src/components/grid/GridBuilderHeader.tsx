/**
 * GridBuilderHeader — the shared top block of the grid builder: the name field,
 * the per-grid options card (name overlay toggle + export), and the
 * "N cameras selected" label.
 *
 * The builder owns grid IDENTITY + MEMBERSHIP only. Runtime view settings
 * (stream quality, layout, highlight triggers) are deliberately NOT here — the
 * grid runtime toolbar is their single editor, so the two surfaces never fight
 * over the same persisted fields.
 *
 * Both the native builder (`GridBuilderScreen`, where this rides as a FlatList
 * `ListHeaderComponent`) and the web builder (`GridBuilderScreen.web`, where it
 * sits atop a scroll view above the drag&drop grid) render it, so the controls
 * stay identical across platforms — only the camera-membership UX below differs
 * (native: checklist + long-press reorder; web: @dnd-kit sortable grid).
 */
import React from 'react'
import { View, Text, TextInput, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Tag, Share2 } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { Section } from '../ui/Section.js'
import { ToggleRow } from '../ui/ToggleRow.js'
import { Row } from '../ui/Row.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { resolveGridOptions, type GridOptions } from '../../store/grid-store.js'

interface GridBuilderHeaderProps {
  readonly name: string
  readonly onChangeName: (name: string) => void
  readonly onCommitName: () => void
  /** Effective per-grid options (caller resolves these via `resolveGridOptions`). */
  readonly options: ReturnType<typeof resolveGridOptions>
  readonly onSetOption: (patch: GridOptions) => void
  readonly onExport: () => void
  readonly selectedCount: number
}

export function GridBuilderHeader({
  name,
  onChangeName,
  onCommitName,
  options,
  onSetOption,
  onExport,
  selectedCount,
}: GridBuilderHeaderProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  return (
    <View style={styles.header}>
      <View style={styles.nameRow}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t('v2.gridBuilder.nameLabel')}</Text>
        <TextInput
          value={name}
          onChangeText={onChangeName}
          onBlur={onCommitName}
          placeholder={t('v2.gridBuilder.namePlaceholder')}
          placeholderTextColor={colors.foregroundSubtle}
          returnKeyType="done"
          onSubmitEditing={onCommitName}
          style={{
            color: colors.foreground,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: RADIUS.md,
            paddingHorizontal: SPACING.lg,
            paddingVertical: SPACING.md,
            fontSize: 16,
          }}
        />
      </View>

      <Section title={t('v2.gridBuilder.optionsTitle')}>
        <ToggleRow
          icon={Tag}
          label={t('v2.gridBuilder.showName')}
          value={options.showName}
          onValueChange={(v) => onSetOption({ showName: v })}
        />
        <Row icon={Share2} label={t('v2.gridBuilder.export')} onPress={onExport} last />
      </Section>

      <Text style={[styles.sectionLabel, { color: colors.foregroundMuted }]}>
        {t('v2.gridBuilder.camerasSelected', { count: selectedCount })}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    gap: SPACING.lg,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
  },
  nameRow: {
    paddingHorizontal: SPACING.sm,
    gap: SPACING.sm,
  },
  sectionLabel: {
    fontSize: 12,
    paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.md,
  },
})
