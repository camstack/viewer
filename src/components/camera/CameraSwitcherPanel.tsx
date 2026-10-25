/**
 * CameraSwitcherPanel — the timeline camera-FAB's floating camera SWITCHER.
 *
 * Lists ALL cameras (`useCameras` — name + online state), highlighting the one
 * currently open. Two interaction modes on camera-detail:
 *   • SINGLE: tapping a row switches the detail view to that camera
 *     (the parent navigates via `router.replace('/camera/<id>')`).
 *   • MULTISELECT: every row carries a checkbox affordance; once a selection
 *     exists, row taps toggle membership instead of switching, and confirming
 *     hands the selection to the parent.
 *
 * What CONFIRMING means is the parent's to say, and it says it with one prop —
 * `selectionMode`, resolved by `camera-selection.ts` from the layout that has a
 * workspace. `openGrid` is what shipped and what a phone keeps: 2+ selected
 * open the ephemeral `/grid/adhoc` route. `buildView` is the tablet: the
 * selection BECOMES the operator's view, drawn under the picture, with no
 * navigation at all — and there one camera is meaningful too, as a `goTo`.
 * The mode drives the minimum AND the wording from one value, so the button
 * cannot promise a grid and deliver a view.
 *
 * There is no separate "timeline scope" mode. It was designed and never wired,
 * and wiring it in 2026-09 would have made this panel a SECOND way to say which
 * cameras the timeline reads — the first being the view itself. A camera
 * removed from the timeline but left on the wall is two knobs disagreeing about
 * one fact; taking it out of the view is the one verb, and it is `removeMember`
 * (`store/workspace.ts`).
 *
 * Presentational + controlled: hosted by `TimelineCameraPanel`, which gives it
 * the whole timeline body (`scroll={false}` — the list scrolls itself, so the
 * "Open grid" action stays docked at the bottom no matter how long the fleet).
 */
import React, { useMemo, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { useTimelineScale } from './theater/TimelineScaleProvider.js'
import { useTranslation } from 'react-i18next'
import { Square, CheckSquare, LayoutGrid, Check } from '../../lib/icons.js'

import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { useCameras } from '../../data/use-cameras.js'
import {
  MIN_SELECTION,
  type CameraSelectionMode,
} from '../../screens/camera-detail/camera-selection.js'

/** Marker for the confirm action. `testID` reaches the web as `data-testid` and
 *  is inert on a device; the "does not navigate" gate is asserted through it
 *  rather than through the button's words, which change with the mode. */
export const CAMERA_SELECT_CONFIRM_TEST_ID = 'camera-select-confirm'

export interface CameraSwitcherPanelProps {
  /** The camera currently open in the detail view (highlighted row). */
  readonly currentId: number
  /** Single tap on a row (no selection active) → switch the detail view. */
  readonly onSwitch: (deviceId: number) => void
  /** The confirmed selection, in list order. What the parent DOES with it is
   *  {@link selectionMode}'s to say — this panel never navigates. */
  readonly onOpenGrid: (deviceIds: readonly number[]) => void
  /** What confirming means here. Defaults to what shipped: route to a grid. */
  readonly selectionMode?: CameraSelectionMode
}

export function CameraSwitcherPanel({
  currentId,
  onSwitch,
  onOpenGrid,
  selectionMode = 'openGrid',
}: CameraSwitcherPanelProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  // Scaled like the rest of the timeline chrome: the panel owns the body now,
  // and a fixed size is the only thing in a narrow landscape drawer that does
  // not shrink with it.
  const ui = useTimelineScale()
  const { data: cameras = [], isLoading } = useCameras()

  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const checked = selected
  const selectionActive = checked.size > 0

  const toggleSelected = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Selected ids in LIST order (stable grid tile order regardless of tap order).
  const selectedInOrder = useMemo(
    () => cameras.filter((c) => checked.has(c.id)).map((c) => c.id),
    [cameras, checked],
  )
  // One number, one source: the same table the outcome resolver reads, so an
  // armed button and a `'none'` outcome cannot disagree.
  const canOpenGrid = selectedInOrder.length >= MIN_SELECTION[selectionMode]

  if (isLoading && cameras.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  }

  if (cameras.length === 0) {
    return (
      <Text style={[styles.empty, { fontSize: ui.font.sm, color: colors.foregroundSubtle }]}>
        {t('v2.cameraSwitcher.empty')}
      </Text>
    )
  }

  return (
    <View style={styles.body}>
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {cameras.map((camera) => {
          const isCurrent = camera.id === currentId
          const isSelected = checked.has(camera.id)
          return (
            <Pressable
              key={camera.id}
              onPress={() =>
                selectionActive ? toggleSelected(camera.id) : onSwitch(camera.id)
              }
              accessibilityRole="button"
              accessibilityState={{ selected: isCurrent }}
              style={[
                styles.row,
                { borderBottomColor: colors.borderSubtle },
                isCurrent && { backgroundColor: `${colors.primary}14` },
              ]}
            >
              {/* Checkbox affordance — always visible so multiselect is
                  discoverable; its own hit target so a single tap on the row
                  body still switches. */}
              <Pressable
                onPress={() => toggleSelected(camera.id)}
                hitSlop={8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={t('v2.cameraSwitcher.selectA11y', { name: camera.name })}
              >
                {isSelected ? (
                  <CheckSquare size={18} color={colors.primary} />
                ) : (
                  <Square size={18} color={colors.foregroundSubtle} />
                )}
              </Pressable>

              <View
                style={[
                  styles.onlineDot,
                  { backgroundColor: camera.online ? colors.success : colors.foregroundSubtle },
                ]}
              />

              <Text
                style={[
                  styles.name,
                  { color: isCurrent ? colors.primary : colors.foreground },
                  isCurrent && styles.nameCurrent,
                ]}
                numberOfLines={1}
              >
                {camera.name}
              </Text>

              {isCurrent ? <Check size={16} color={colors.primary} /> : null}
            </Pressable>
          )
        })}
      </ScrollView>

      {/* The confirm — armed at the minimum this mode gives meaning to. */}
      {selectionActive ? (
        <Pressable
          onPress={() => {
            if (canOpenGrid) onOpenGrid(selectedInOrder)
          }}
          disabled={!canOpenGrid}
          testID={CAMERA_SELECT_CONFIRM_TEST_ID}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canOpenGrid }}
          style={[
            styles.gridButton,
            canOpenGrid
              ? { backgroundColor: colors.primary }
              : { backgroundColor: colors.backgroundElevated },
          ]}
        >
          <LayoutGrid
            size={15}
            color={canOpenGrid ? colors.primaryForeground : colors.foregroundDisabled}
          />
          <Text
            style={[
              styles.gridButtonText,
              { color: canOpenGrid ? colors.primaryForeground : colors.foregroundDisabled },
            ]}
          >
            {t(
              selectionMode === 'buildView'
                ? 'v2.cameraSwitcher.buildView'
                : 'v2.cameraSwitcher.openGrid',
              { count: selectedInOrder.length, n: selectedInOrder.length },
            )}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  center: { paddingVertical: SPACING.lg, alignItems: 'center' },
  empty: { fontSize: 13, padding: SPACING.lg, textAlign: 'center' },
  // The panel host hands over the whole box (`scroll={false}`), so this owns
  // its own padding — and the list takes whatever is left after the action.
  body: { flex: 1, gap: SPACING.sm, padding: SPACING.lg },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.sm,
  },
  onlineDot: { width: 7, height: 7, borderRadius: 4 },
  name: { flex: 1, fontSize: 14, fontWeight: '500' },
  nameCurrent: { fontWeight: '700' },
  gridButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
  },
  gridButtonText: { fontSize: 13, fontWeight: '600' },
})
