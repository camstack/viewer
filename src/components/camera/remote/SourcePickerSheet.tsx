/**
 * The sources of a remote in the shared picker sheet: Channels (number + name)
 * and Inputs (declared key sequences). A pick sends and closes; the sheet owns
 * no state about the send — the caller shows a refusal.
 */
import React from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Check, X } from '../../../lib/icons.js'
import { hapticTap } from '../../../lib/haptics.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY } from '../../../theme/tokens.js'
import { PickerSheet, PickerSheetButton } from '../../ui/PickerSheet.js'
import { sourceSections, type RemoteSource } from './remote-layout.js'

export interface SourcePickerSheetProps {
  readonly sources: readonly RemoteSource[]
  /** The current source's name, when known. */
  readonly current: string | null
  readonly onPick: (source: RemoteSource) => void
  readonly onClose: () => void
}

interface RowProps {
  readonly source: RemoteSource
  readonly active: boolean
  readonly onPick: (source: RemoteSource) => void
}

function SourceRow({ source, active, onPick }: RowProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      testID={`remote-source-${source.id}`}
      onPress={() => {
        hapticTap()
        onPick(source)
      }}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.surfaceHover } : null]}
    >
      {source.kind === 'digits' ? (
        <Text style={[styles.number, { color: colors.foregroundMuted }]}>{source.number}</Text>
      ) : null}
      <Text numberOfLines={1} style={[styles.name, { color: active ? colors.primary : colors.foreground }]}>
        {source.name}
      </Text>
      {active ? <Check size={16} color={colors.primary} /> : null}
    </Pressable>
  )
}

interface SectionProps {
  readonly title: string
  readonly sources: readonly RemoteSource[]
  readonly current: string | null
  readonly onPick: (source: RemoteSource) => void
  readonly testID: string
}

function Section({ title, sources, current, onPick, testID }: SectionProps): React.JSX.Element | null {
  const { colors } = useTheme()
  if (sources.length === 0) return null
  return (
    <View testID={testID} style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.foregroundSubtle }]}>{title}</Text>
      {sources.map((s) => (
        <SourceRow key={s.id} source={s} active={current !== null && s.name === current} onPick={onPick} />
      ))}
    </View>
  )
}

export function SourcePickerSheet({ sources, current, onPick, onClose }: SourcePickerSheetProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { channels, inputs } = sourceSections(sources)
  return (
    <PickerSheet
      testID="remote-source-sheet"
      title={t('v2.remote.sources.title')}
      subtitle={current === null ? undefined : t('v2.remote.sources.current', { name: current })}
      onClose={onClose}
      headerRight={
        <PickerSheetButton onPress={onClose} label={t('v2.common.close')}>
          <X size={18} color={colors.foreground} />
        </PickerSheetButton>
      }
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
        <Section testID="remote-sources-channels" title={t('v2.remote.sources.channels')} sources={channels} current={current} onPick={onPick} />
        <Section testID="remote-sources-inputs" title={t('v2.remote.sources.inputs')} sources={inputs} current={current} onPick={onPick} />
      </ScrollView>
    </PickerSheet>
  )
}

const styles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  list: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg, gap: SPACING.lg },
  section: { gap: SPACING.xs },
  sectionTitle: { fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.medium, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.md },
  number: { minWidth: 36, fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.medium },
  name: { flex: 1, textAlign: 'left', fontSize: TYPOGRAPHY.size.md },
})
