/**
 * ReelHighlightSheet — "how the reel's cards light up", the operator's modal
 * (D483 phase two).
 *
 * They asked for *«un pulsante come quello sulla pagina cameras per mostrare un
 * modal con le settings, mi interessano solo gli highlights»*. So this is
 * `CamerasDisplaySheet`'s chrome — the same slide-up sheet, scrim, header and
 * `Section` — with exactly one section in it.
 *
 * ## "Solo gli highlights": all three rows
 *
 * `HighlightTriggerRows` renders motion, audio AND detection (toggle + class
 * chips + hold). *«Solo gli highlights»* is read as "the highlight editor, not
 * the rest of the view options" rather than "motion and audio only", because
 * those three rows ARE the highlight editor: splitting them would make this the
 * fourth surface that edits a `GridHighlightSettings` and the first one that
 * edits a subset, and the shared editor's whole purpose is that no surface owns
 * a variant of it. Motion and audio are the DEFAULTS
 * (`REEL_HIGHLIGHT_DEFAULTS`); detection is present and off.
 *
 * State and persistence are the caller's, exactly as `HighlightTriggerRows`
 * requires — here `reel-highlight-store.ts`. This file adds no state of its own.
 */
import React, { memo } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { SheetModal } from '../ui/SheetModal.js'
import { Section } from '../ui/Section.js'
import { HighlightTriggerRows } from './HighlightTriggerRows.js'
import { useReelHighlightStore } from '../../store/reel-highlight-store.js'

export interface ReelHighlightSheetProps {
  readonly visible: boolean
  readonly onClose: () => void
}

export const ReelHighlightSheet = memo(function ReelHighlightSheet({
  visible,
  onClose,
}: ReelHighlightSheetProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  // Selector per field: this sheet re-renders on every patch, and the reel
  // behind it must not.
  const highlight = useReelHighlightStore((s) => s.highlight)
  const setHighlight = useReelHighlightStore((s) => s.setHighlight)
  const reset = useReelHighlightStore((s) => s.reset)

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      sheetStyle={[styles.sheet, { backgroundColor: colors.backgroundElevated }]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t('v2.reelHighlight.title')}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('v2.reelHighlight.close')}
          style={[styles.iconBtn, { backgroundColor: colors.surface }]}
        >
          <X size={18} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Section title={t('v2.reelHighlight.section')}>
          {/* The shared editor, verbatim. Nothing here decides which rows
              exist — that is the point of it being shared with the
              camera-detail overlay panel, the grid menu and the grid share
              dialog. */}
          <HighlightTriggerRows highlight={highlight} onSetHighlight={setHighlight} />
        </Section>
        <Pressable
          onPress={reset}
          accessibilityRole="button"
          style={[styles.resetBtn, { backgroundColor: colors.surface }]}
        >
          <Text style={[styles.resetText, { color: colors.foreground }]}>
            {t('v2.reelHighlight.reset')}
          </Text>
        </Pressable>
      </ScrollView>
    </SheetModal>
  )
})

const styles = StyleSheet.create({
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: SPACING.sm,
  },
  title: { fontSize: 18, fontWeight: '700' },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { gap: SPACING.lg, paddingVertical: SPACING.sm, paddingBottom: SPACING.xl },
  resetBtn: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    marginHorizontal: SPACING.md,
  },
  resetText: { fontSize: 15, fontWeight: '600' },
})
