/**
 * ReelFilterSheet — what the Recent strip on the Cameras screen shows.
 *
 * Reached from the Cameras fan menu, next to Appearance and Edit list: the
 * reel's controls already live beside their content (`CamerasDisplaySheet`
 * says so), and this is the same rule for the one control that is a FILTER
 * rather than a presentation choice.
 *
 * The picker is `EventKindTreeSection` — the same taxonomy tree the events
 * page and the camera timeline use, given a third selection to own. Nothing
 * about which kinds exist is written here.
 *
 * ## The three buttons are the store's three answers
 *
 * `Default` (the detection macros, re-resolved from the live taxonomy every
 * read), `All` (an explicit empty selection that persists) and whatever the
 * ticks make. They are not the same as each other and the sheet says which one
 * is live, because `default` is a NARROWING — it leaves out audio and sensor
 * markers — and an operator who is not told that is left wondering where an
 * event went.
 */
import React, { memo, useMemo } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { X } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { SheetModal } from '../../ui/SheetModal.js'
import { useCameras } from '../../../data/use-cameras.js'
import { useEventKinds } from '../../../data/use-event-kinds.js'
import {
  reelFilterCondition,
  resolveReelClasses,
  useReelFilterStore,
} from '../../../store/reel-filter-store.js'
import { EventKindTreeSection } from '../EventKindTree.js'
import { KeyboardAwareScrollView } from '../../ui/KeyboardInset.js'

const NO_OBSERVED_CLASSES: readonly string[] = []

export interface ReelFilterSheetProps {
  readonly visible: boolean
  readonly onClose: () => void
}

export const ReelFilterSheet = memo(function ReelFilterSheet({
  visible,
  onClose,
}: ReelFilterSheetProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()

  const filter = useReelFilterStore((s) => s.filter)
  const toggleClass = useReelFilterStore((s) => s.toggleClass)
  const showAll = useReelFilterStore((s) => s.showAll)
  const useDefault = useReelFilterStore((s) => s.useDefault)

  // The strip is fleet-wide, so its taxonomy is the merged one — the same
  // device set `TrackReel` asks for, so the kinds offered here are the
  // kinds the request can actually narrow by.
  const { data: cameras } = useCameras({ includeHidden: true })
  const deviceIds = useMemo(() => (cameras ?? []).map((c) => c.id), [cameras])
  const eventKinds = useEventKinds(deviceIds)

  const selected = resolveReelClasses(filter, eventKinds.data)
  const condition = reelFilterCondition(filter)

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      sheetStyle={[
        styles.sheet,
        { backgroundColor: colors.background, paddingBottom: insets.bottom + SPACING.lg },
      ]}
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t('v2.cameras.reelFilter', 'Recent events')}
        </Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('v2.common.close', 'Close')}
          hitSlop={8}
        >
          <X size={20} color={colors.foregroundMuted} />
        </Pressable>
      </View>

      {/* The active condition, in words, at the top of its own control. The
          `default` case is the one that matters: it is a narrowing, and a
          strip that is quietly shorter than reality is the failure this
          whole line of work exists to remove. */}
      <Text
        testID="reel-filter-condition"
        style={[styles.condition, { color: colors.foregroundSubtle }]}
      >
        {condition.kind === 'all'
          ? t('v2.cameras.reelFilterAll', 'Showing every event')
          : condition.kind === 'default'
            ? t(
                'v2.cameras.reelFilterDefaultHint',
                'Showing detection events only — audio and sensor events are hidden',
              )
            : t('v2.cameras.reelFilterCount', '{{count}} event types shown', {
                count: condition.count,
              })}
      </Text>

      <View style={styles.presets}>
        <PresetButton
          label={t('v2.cameras.reelFilterUseDefault', 'Default')}
          active={condition.kind === 'default'}
          onPress={useDefault}
          colors={colors}
        />
        <PresetButton
          label={t('v2.cameras.reelFilterShowAll', 'Everything')}
          active={condition.kind === 'all'}
          onPress={showAll}
          colors={colors}
        />
      </View>

      <KeyboardAwareScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <EventKindTreeSection
          descriptors={eventKinds.data}
          // No flat fallback: this sheet is a NEW surface and has no legacy
          // class list to degrade to. A hub that advertises no taxonomy
          // leaves the tree empty and the preset buttons still work — which
          // is honest, unlike offering a hand-written vocabulary.
          observedClasses={NO_OBSERVED_CLASSES}
          selected={selected}
          onToggleClass={(kind) => {
            toggleClass(kind, selected)
          }}
          onSetClasses={(classes) => {
            // The tree's macro toggle replaces the whole selection. Route it
            // through the same reducer so the FIRST edit still materialises
            // the default preset instead of starting from nothing.
            const next = new Set(classes)
            const previous = new Set(selected)
            for (const kind of next) if (!previous.has(kind)) toggleClass(kind, selected)
            for (const kind of previous) if (!next.has(kind)) toggleClass(kind, selected)
          }}
        />
      </KeyboardAwareScrollView>
    </SheetModal>
  )
})

interface PresetButtonProps {
  readonly label: string
  readonly active: boolean
  readonly onPress: () => void
  readonly colors: { readonly primary: string; readonly primaryForeground: string; readonly surface: string; readonly foregroundMuted: string }
}

function PresetButton({ label, active, onPress, colors }: PresetButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.preset, { backgroundColor: active ? colors.primary : colors.surface }]}
    >
      <Text
        style={[
          styles.presetText,
          { color: active ? colors.primaryForeground : colors.foregroundMuted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '80%',
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '700' },
  condition: { fontSize: 12, marginTop: SPACING.xs },
  presets: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  preset: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.xl,
  },
  presetText: { fontSize: 13, fontWeight: '600' },
  body: { marginTop: SPACING.md },
  bodyContent: { paddingBottom: SPACING.lg },
})
