/**
 * TimelineFloatingTools — the timeline's tools, floating over the list.
 *
 * Replaces the docked footer band. ONE glass bar at the BOTTOM of the tools
 * overlay, {@link TOOLBAR_CONTROL_SIZE} tall like every other toolbar of the
 * player (it was drawn at the lane header's 24 pt and read cropped, squashed
 * under the heatmap), centred in the card column between hour labels and
 * activity lanes:
 *
 *   Filtri · Zona (if any) · `−` range `+` · Clip
 *
 * The layer is a SIBLING of the scroller (`pointerEvents="box-none"`), never
 * inside its content, and only the bar itself takes touches: the rest of the
 * layer — the scrub handle and the cards beside the bar — stays reachable. The
 * list reserves {@link floatingToolsBottomInset} at the bottom so the last
 * cards can scroll above the bar. Idle pills read `foreground` on glass;
 * an engaged one uses `warningFill` / `warningOn`.
 *
 * The range label opens Auto + presets; `−` / `+` step the same ladder
 * (`timeline-zoom-step.ts`) and disable at the ends.
 */
import React, { memo, useCallback, useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Filter, Scan, Clapperboard, Plus, Minus } from '../../../lib/icons.js'
import type { LucideIcon } from '../../../lib/icons.js'

import { hapticTap } from '../../../lib/haptics.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { GlassSurface } from '../../ui/GlassSurface.js'
import { GlassPressable } from '../../ui/GlassButton.js'
import { LANE_HEADER_HEIGHT_PX } from './TimelineLaneHeader.js'
import { TOOLBAR_CONTROL_SIZE } from './TimelineToolbarInline.js'
import { useTimelineScale } from './TimelineScaleProvider.js'
import { zoomSpanLabel, zoomIndicesByRange } from './mock-data.js'
import { formatZoomSpan } from './zoom-range-label.js'
import { stepZoomIndex, type ZoomStepDirection } from './timeline-zoom-step.js'
import type { TimelineZoomMode } from './timeline-zoom-mode.js'

/** Fixed span indices, or the Auto mode row. */
export type ZoomMenuValue = number | 'auto'

export type { TimelineZoomMode }

/** Minimum hit target (pt) of every floating control. */
export const FLOATING_TOOL_SIZE = 44

/** Same glyph size as the lane-header icons beside this bar. */
const TOOL_ICON_PX = 14
const TOOL_HIT_SLOP = Math.ceil((FLOATING_TOOL_SIZE - TOOLBAR_CONTROL_SIZE) / 2)

/**
 * Points the scroll content reserves above the axis: the lane-header row (the
 * lane icons are fixed at the top of the body) so the first cards sit below it.
 */
export function floatingToolsTopInset(): number {
  return SPACING.sm + LANE_HEADER_HEIGHT_PX + SPACING.sm
}

/**
 * Points the scroll content reserves BELOW the last card so the bottom tools
 * bar cannot bury it: the content under a float with no matching inset is
 * unreachable, there being nothing left to scroll.
 */
export function floatingToolsBottomInset(): number {
  return SPACING.sm + TOOLBAR_CONTROL_SIZE + SPACING.sm
}

export interface TimelineFloatingToolsProps {
  readonly zoomIndex: number
  readonly zoomMode: TimelineZoomMode
  readonly onZoomIndexChange: (index: number) => void
  readonly onZoomModeChange: (mode: TimelineZoomMode) => void
  readonly zoomEnabled: boolean
  readonly onFilter: () => void
  readonly onZoneFilter?: () => void
  readonly onOpenClips: () => void
  readonly clipsActive: boolean
  readonly filterActive: boolean
  readonly zoneActive: boolean
  /** Same left reserve as {@link TimelineScroller}'s card band. */
  readonly leftReserve: number
  /** Same right reserve as the card band (lanes or edge padding). */
  readonly rightReserve: number
}

export const TimelineFloatingTools = memo(function TimelineFloatingTools({
  zoomIndex,
  zoomMode,
  onZoomIndexChange,
  onZoomModeChange,
  zoomEnabled,
  onFilter,
  onZoneFilter,
  onOpenClips,
  clipsActive,
  filterActive,
  zoneActive,
  leftReserve,
  rightReserve,
}: TimelineFloatingToolsProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ui = useTimelineScale()
  const [menuOpen, setMenuOpen] = useState(false)

  const zoomOptions = useMemo(
    () => [
      { value: 'auto' as ZoomMenuValue, label: t('v2.theater.zoomAuto') },
      ...zoomIndicesByRange().map((index) => ({
        value: index as ZoomMenuValue,
        label: formatZoomSpan(zoomSpanLabel(index), t),
      })),
    ],
    [t],
  )
  const menuValue: ZoomMenuValue = zoomMode === 'auto' ? 'auto' : zoomIndex
  const rangeLabel =
    zoomMode === 'auto' ? t('v2.theater.zoomAuto') : formatZoomSpan(zoomSpanLabel(zoomIndex), t)

  const pick = useCallback(
    (value: ZoomMenuValue): void => {
      if (value === 'auto') {
        onZoomModeChange('auto')
        return
      }
      onZoomModeChange('fixed')
      onZoomIndexChange(value)
    },
    [onZoomIndexChange, onZoomModeChange],
  )
  const shorter = zoomEnabled ? stepZoomIndex(zoomIndex, 'shorter') : null
  const longer = zoomEnabled ? stepZoomIndex(zoomIndex, 'longer') : null
  const step = (direction: ZoomStepDirection): void => {
    const next = direction === 'shorter' ? shorter : longer
    if (next === null) return
    hapticTap()
    setMenuOpen(false)
    pick(next)
  }

  const activeTint = colors.warningFill
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityLabel={t('v2.theater.toolsLayer')}>
      <View
        style={[styles.bar, { bottom: SPACING.sm, left: leftReserve, right: rightReserve }]}
        pointerEvents="box-none"
      >
        <GlassSurface contentStyle={styles.barRow} testID="timeline-tools-bar">
          <ToolPill
            icon={Filter}
            label={t('v2.theater.filterTitle')}
            active={filterActive}
            tint={activeTint}
            onPress={() => {
              setMenuOpen(false)
              onFilter()
            }}
          />
          {onZoneFilter ? (
            <ToolPill
              icon={Scan}
              label={t('v2.theater.zoneFilter')}
              active={zoneActive}
              tint={activeTint}
              onPress={() => {
                setMenuOpen(false)
                onZoneFilter()
              }}
            />
          ) : null}
          <BarDivider />
          <StepButton
            icon={Minus}
            label={t('v2.theater.zoomShorter')}
            disabled={shorter === null}
            onPress={() => step('shorter')}
          />
          <GlassPressable
            onPress={() => setMenuOpen((open) => !open)}
            disabled={!zoomEnabled}
            hitSlop={TOOL_HIT_SLOP}
            label={t('v2.theater.zoomRange')}
            expanded={menuOpen}
            style={[styles.rangeButton, { opacity: zoomEnabled ? 1 : 0.4 }]}
          >
            <Text
              numberOfLines={1}
              style={{
                fontSize: 11,
                fontWeight: '700',
                fontVariant: ['tabular-nums'],
                color: menuOpen ? colors.primary : colors.foreground,
              }}
            >
              {rangeLabel}
            </Text>
          </GlassPressable>
          <StepButton
            icon={Plus}
            label={t('v2.theater.zoomLonger')}
            disabled={longer === null}
            onPress={() => step('longer')}
          />
          <BarDivider />
          <ToolPill
            icon={Clapperboard}
            label={t('v2.clips.title')}
            active={clipsActive}
            tint={activeTint}
            onPress={() => {
              setMenuOpen(false)
              onOpenClips()
            }}
          />
        </GlassSurface>
        <View style={styles.zoomAnchor} pointerEvents="box-none">
          {menuOpen ? (
            <View
              style={[
                styles.menu,
                {
                  marginBottom: SPACING.md,
                  borderRadius: ui.radius.lg,
                  backgroundColor: colors.backgroundElevated,
                  borderColor: colors.border,
                },
              ]}
              accessibilityRole="menu"
            >
              {zoomOptions.map((option) => {
                const active = option.value === menuValue
                return (
                  <Pressable
                    key={String(option.value)}
                    onPress={() => {
                      hapticTap()
                      pick(option.value)
                      setMenuOpen(false)
                    }}
                    style={[styles.menuItem, active ? { backgroundColor: colors.primary } : null]}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={option.label}
                  >
                    <Text
                      style={{
                        fontSize: ui.font.sm,
                        fontWeight: active ? '700' : '600',
                        fontVariant: ['tabular-nums'],
                        color: active ? colors.primaryForeground : colors.foreground,
                      }}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )
})

interface ToolPillProps {
  readonly icon: LucideIcon
  readonly label: string
  readonly active: boolean
  readonly tint: string
  readonly onPress: () => void
}

function ToolPill({ icon: Icon, label, active, tint, onPress }: ToolPillProps) {
  const { colors } = useTheme()
  const ink = active ? colors.warningOn : colors.foreground
  return (
    <GlassPressable
      label={label}
      selected={active}
      onPress={onPress}
      hitSlop={TOOL_HIT_SLOP}
      style={[styles.segment, active ? { backgroundColor: tint } : null]}
    >
      <Icon size={TOOL_ICON_PX} color={ink} />
    </GlassPressable>
  )
}

function BarDivider(): React.JSX.Element {
  const { colors } = useTheme()
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />
}

interface StepButtonProps {
  readonly icon: LucideIcon
  readonly label: string
  readonly disabled: boolean
  readonly onPress: () => void
}

function StepButton({ icon: Icon, label, disabled, onPress }: StepButtonProps) {
  const { colors } = useTheme()
  return (
    <GlassPressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={TOOL_HIT_SLOP}
      label={label}
      style={[styles.segment, { opacity: disabled ? 0.35 : 1 }]}
    >
      <Icon size={TOOL_ICON_PX} color={colors.foreground} />
    </GlassPressable>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: TOOLBAR_CONTROL_SIZE,
    paddingHorizontal: SPACING.sm,
    gap: SPACING.xs,
  },
  segment: {
    minWidth: TOOLBAR_CONTROL_SIZE,
    height: TOOLBAR_CONTROL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: TOOLBAR_CONTROL_SIZE / 2,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 12,
    marginHorizontal: SPACING.sm,
  },
  rangeButton: {
    height: TOOLBAR_CONTROL_SIZE,
    paddingHorizontal: SPACING.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** As tall as the bar, so the range menu (`bottom: '100%'`) opens ABOVE it. */
  zoomAnchor: { position: 'relative', height: TOOLBAR_CONTROL_SIZE },
  menu: {
    position: 'absolute',
    bottom: '100%',
    alignSelf: 'center',
    minWidth: 120,
    borderWidth: 1,
    paddingVertical: 2,
    zIndex: 10,
  },
  menuItem: {
    minHeight: FLOATING_TOOL_SIZE,
    paddingHorizontal: SPACING.xl,
    justifyContent: 'center',
  },
})
