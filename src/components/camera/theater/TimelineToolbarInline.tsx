/**
 * TimelineToolbarInline — the inline toolbar above the heatmap.
 *
 * Three glass capsules at {@link TOOLBAR_CONTROL_SIZE}:
 *   1. nav — back, alone
 *   2. date — alone
 *   3. actions — linked · PTZ · cog · quality · camera switch (one surface)
 *
 * The legend ("help") button left this bar on the operator's decision
 * (2026-10-21); the camera switch took its place at the end of the actions
 * capsule.
 *
 * Presentational only — toggles are driven by props.
 */
import React, { memo, useCallback, useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useTimelineScale } from './TimelineScaleProvider.js'
import {
  ChevronLeft,
  Video,
  Calendar,
  Check,
  ChevronDown,
  Settings,
  Lightbulb,
  Move,
  Gauge,
} from '../../../lib/icons.js'

import { BatteryBadge } from '../BatteryBadge.js'
import { NetworkLinkBadge, networkLinkBadgeVisible } from '../NetworkLinkBadge.js'
import {
  StatusBadgeButton,
  StatusDetailPopover,
  useStatusDetail,
} from '../StatusDetailPopover.js'
import { batteryDetailLines, networkLinkDetailLines } from '../status-detail-lines.js'
import { StreamBadge, streamBadgeVisible } from '../StreamBadge.js'
import type { BatteryStatus } from '../../../data/use-battery.js'
import type { NetworkLinkStatus } from '../../../data/use-network-link.js'
import { GlassSurface } from '../../ui/GlassSurface.js'
import { GlassPressable } from '../../ui/GlassButton.js'
import { hapticTap } from '../../../lib/haptics.js'
import type { DateLabelFormat } from '../../../recording/day-nav.js'
import { fitToolbar, type ToolbarActionId } from './timeline-toolbar-fit.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'

/** Diameter / row height of every control in this toolbar — under ScreenHeader's 40. */
export const TOOLBAR_CONTROL_SIZE = 36

export interface TimelineToolbarInlineProps {
  readonly onBack: () => void
  /** Hide the back arrow — the wide layout's rail lives beside the app
   *  sidebar, which already provides navigation. Default false (mobile). */
  readonly hideBack?: boolean
  /** Date pill label in the requested format (full / short / day number). */
  readonly dateLabel: (format: DateLabelFormat) => string
  /** The camera this toolbar belongs to — the status card shows its stream. */
  readonly deviceId?: number
  readonly battery?: BatteryStatus | null
  /** The camera's own link (wifi / cellular); absent for wired ones. */
  readonly networkLink?: NetworkLinkStatus | null
  readonly onOpenDatePicker?: () => void
  /** Jump to another camera. Absent ⟺ no button (a wall, or a tablet whose
   *  camera shelf already does this). */
  readonly onPickCamera?: () => void
  readonly cameraPickerOpen?: boolean

  /**
   * Gone from this bar, on the operator's decision (2026-09-02), and gone
   * rather than hidden behind a flag: PTZ, the linked-devices panel and the
   * capture menu (snapshot + recording export).
   *
   * The reason is the same for all three and it is what this bar BECAME. It is
   * no longer one camera's toolbar: the timeline under it aggregates every
   * camera in the view, so a control here has to mean something for a SET.
   * See `TimelineSingleCameraBindings`.
   */
  readonly menuOpen?: boolean
  readonly onToggleMenu?: () => void
  readonly onOpenLinkedDevices?: () => void
  readonly linkedDevicesOpen?: boolean
  readonly onOpenPtz?: () => void
  readonly ptzOpen?: boolean
  readonly qualityOpen?: boolean
  readonly onToggleQuality?: () => void
  readonly qualityLabel?: string
  readonly qualityOptions?: readonly QualityOption[]
  readonly qualityValue?: string
  readonly onSelectQuality?: (value: string) => void
}

/** One selectable stream tier in the quality drop-down. */
export interface QualityOption {
  readonly value: string
  readonly label: string
}


export const TimelineToolbarInline = memo(function TimelineToolbarInline(
  props: TimelineToolbarInlineProps,
) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ui = useTimelineScale()
  const status = useStatusDetail()

  const showNav = !props.hideBack

  // What the row can hold. Measured, not assumed: in the landscape drawer the
  // widest header is wider than the panel, and what did not fit used to be
  // clipped off-screen. The notch side's inset narrows the budget too.
  const insets = useSafeAreaInsets()
  const [rowWidth, setRowWidth] = useState<number | null>(null)
  const onRowLayout = useCallback((e: LayoutChangeEvent): void => {
    const width = Math.round(e.nativeEvent.layout.width)
    setRowWidth((prev) => (prev === width ? prev : width))
  }, [])

  const present = useMemo((): readonly ToolbarActionId[] => {
    const ids: ToolbarActionId[] = []
    if (props.onOpenLinkedDevices != null) ids.push('linked')
    if (props.onOpenPtz != null) ids.push('ptz')
    if (props.onToggleMenu != null) ids.push('settings')
    if (props.qualityLabel !== undefined) ids.push('quality')
    if (props.onPickCamera != null) ids.push('camera')
    return ids
  }, [props.onOpenLinkedDevices, props.onOpenPtz, props.onToggleMenu, props.qualityLabel, props.onPickCamera])

  const batteryShown = Boolean(props.battery)
  const linkShown = Boolean(networkLinkBadgeVisible(props.networkLink) && props.networkLink)
  const streamShown =
    props.deviceId !== undefined &&
    streamBadgeVisible({ batteryVisible: batteryShown, linkVisible: linkShown })
  const fit = fitToolbar({
    rowWidth,
    insetRight: insets.right,
    showBack: showNav,
    actions: present,
    statusBadges: Number(batteryShown) + Number(linkShown) + Number(streamShown),
  })
  // Every button is always drawn; the fit only compacts how (gaps, date format,
  // quality glyph, control size).
  const size = fit.controlSize
  const ICON = Math.round(size * 0.5)
  const RADIUS = size / 2
  const sized = useMemo(
    () => ({
      capsule: { height: size },
      capsuleRow: { height: size },
      segment: { width: size, height: size },
      qualitySegment: { height: size, minWidth: size },
      dateSurface: { height: size },
      dateContent: { height: size },
      datePress: { height: size },
      statusSlot: { height: size },
    }),
    [size],
  )
  const showActions = present.length > 0

  const glyph = (active: boolean | undefined) =>
    active === true ? colors.primaryFill : colors.foreground

  return (
    <View style={[styles.container, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      <View
        style={[
          styles.row,
          { gap: fit.gap, paddingLeft: fit.padding, paddingRight: fit.padding + insets.right },
        ]}
        onLayout={onRowLayout}
      >
        {showNav ? (
          <GlassSurface
            radius={RADIUS}
            style={[styles.capsule, sized.capsule]}
            contentStyle={[styles.capsuleRow, sized.capsuleRow]}
            testID="timeline-nav-capsule"
          >
            <GlassPressable
              style={[styles.segment, sized.segment]}
              onPress={props.onBack}
              label={t('v2.common.back')}
              testID="timeline-nav-back"
            >
              <ChevronLeft size={ICON} color={colors.foreground} />
            </GlassPressable>
          </GlassSurface>
        ) : null}

        <GlassSurface
          radius={RADIUS}
          style={[styles.dateSurface, sized.dateSurface]}
          contentStyle={[styles.dateContent, sized.dateContent]}
          testID="timeline-date-pill"
        >
          <GlassPressable
            onPress={props.onOpenDatePicker}
            label={t('v2.theater.selectDate')}
            style={[styles.datePress, sized.datePress]}
          >
            <Calendar size={Math.round(ICON * 0.9)} color={colors.foreground} />
            <Text
              style={[styles.dateText, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {props.dateLabel(fit.dateFormat)}
            </Text>
            <ChevronDown size={Math.round(ICON * 0.75)} color={colors.foreground} />
          </GlassPressable>
        </GlassSurface>

        <View style={styles.spacer} />

        {props.battery ? (
          <View style={[styles.statusSlot, sized.statusSlot]}>
            <StatusBadgeButton subject="battery" lines={batteryDetailLines(props.battery)} controller={status}>
              <BatteryBadge battery={props.battery} colors={colors} size={ICON} compact neutral="foreground" />
            </StatusBadgeButton>
          </View>
        ) : null}
        {networkLinkBadgeVisible(props.networkLink) && props.networkLink ? (
          <View style={[styles.statusSlot, sized.statusSlot]}>
            <StatusBadgeButton subject="link" lines={networkLinkDetailLines(props.networkLink)} controller={status}>
              <NetworkLinkBadge link={props.networkLink} colors={colors} size={ICON} compact neutral="foreground" />
            </StatusBadgeButton>
          </View>
        ) : null}
        {streamShown ? (
          <View style={[styles.statusSlot, sized.statusSlot]}>
            <StatusBadgeButton subject="stream" lines={[]} controller={status}>
              <StreamBadge colors={colors} size={ICON} neutral="foreground" />
            </StatusBadgeButton>
          </View>
        ) : null}

        {showActions ? (
          // Menu is a SIBLING of the clipped GlassSurface — overflow:hidden on
          // the capsule would otherwise cut the drop-down (reviewer, 1.0.636).
          <View style={styles.actionsOuter} testID="timeline-actions-capsule">
            <GlassSurface
              radius={RADIUS}
              style={[styles.capsule, sized.capsule]}
              contentStyle={[styles.capsuleRow, sized.capsuleRow]}
            >
              {props.onOpenLinkedDevices ? (
                <GlassPressable
                  style={[styles.segment, sized.segment]}
                  onPress={props.onOpenLinkedDevices}
                  label={t('v2.linkedDevices.title', 'Linked devices')}
                  selected={props.linkedDevicesOpen === true}
                >
                  <Lightbulb size={ICON} color={glyph(props.linkedDevicesOpen)} />
                </GlassPressable>
              ) : null}
              {props.onOpenPtz ? (
                <GlassPressable
                  style={[styles.segment, sized.segment]}
                  onPress={props.onOpenPtz}
                  label={t('v2.ptz.title', 'PTZ')}
                  selected={props.ptzOpen === true}
                >
                  <Move size={ICON} color={glyph(props.ptzOpen)} />
                </GlassPressable>
              ) : null}
              {props.onToggleMenu ? (
                <GlassPressable
                  style={[styles.segment, sized.segment]}
                  onPress={props.onToggleMenu}
                  label={t('v2.cameraMenu.title')}
                  selected={props.menuOpen === true}
                >
                  <Settings size={ICON} color={glyph(props.menuOpen)} />
                </GlassPressable>
              ) : null}
              {props.qualityLabel === undefined ? null : (
                <GlassPressable
                  style={[styles.qualitySegment, sized.qualitySegment]}
                  onPress={props.onToggleQuality}
                  label={
                    fit.qualityIconOnly
                      ? `${t('v2.theater.quality', 'Quality')}: ${props.qualityLabel}`
                      : t('v2.theater.quality', 'Quality')
                  }
                  selected={props.qualityOpen === true}
                  expanded={props.qualityOpen === true}
                >
                  {fit.qualityIconOnly ? (
                    <Gauge size={ICON} color={glyph(props.qualityOpen)} />
                  ) : (
                    <Text style={[styles.qualityText, { color: glyph(props.qualityOpen) }]}>
                      {props.qualityLabel}
                    </Text>
                  )}
                </GlassPressable>
              )}
              {props.onPickCamera ? (
                <GlassPressable
                  style={[styles.segment, sized.segment]}
                  onPress={props.onPickCamera}
                  label={t('v2.cameraSwitcher.title')}
                  expanded={props.cameraPickerOpen === true}
                  selected={props.cameraPickerOpen === true}
                  testID="timeline-nav-camera"
                >
                  <Video size={ICON} color={glyph(props.cameraPickerOpen)} />
                </GlassPressable>
              ) : null}
            </GlassSurface>
            {props.qualityOpen && props.qualityOptions && props.qualityOptions.length > 0 ? (
              <View
                style={[
                  styles.qualityMenu,
                  {
                    // Sit under the quality segment: the camera switch (when present)
                    // is the only control to its right, one control wide.
                    right: props.onPickCamera ? size : 0,
                    marginTop: SPACING.xs,
                    borderRadius: ui.radius.lg,
                    backgroundColor: colors.backgroundElevated,
                    borderColor: colors.border,
                  },
                ]}
                accessibilityRole="menu"
              >
                {props.qualityOptions.map((option) => {
                  const active = option.value === props.qualityValue
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => {
                        hapticTap()
                        props.onSelectQuality?.(option.value)
                      }}
                      style={styles.qualityRow}
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected: active }}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          color: active ? colors.primary : colors.foreground,
                          fontWeight: active ? '700' : '500',
                        }}
                      >
                        {option.label}
                      </Text>
                      {active ? <Check size={14} color={colors.primary} /> : null}
                    </Pressable>
                  )
                })}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <StatusDetailPopover
        controller={status}
        battery={props.battery}
        link={props.networkLink}
        {...(props.deviceId === undefined ? {} : { deviceId: props.deviceId })}
        colors={colors}
        placement="below"
      />
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    zIndex: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: TOOLBAR_CONTROL_SIZE + SPACING.md * 2,
  },
  capsule: {
    height: TOOLBAR_CONTROL_SIZE,
    flexShrink: 0,
  },
  capsuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: TOOLBAR_CONTROL_SIZE,
  },
  segment: {
    width: TOOLBAR_CONTROL_SIZE,
    height: TOOLBAR_CONTROL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateSurface: {
    height: TOOLBAR_CONTROL_SIZE,
    maxWidth: '42%',
  },
  dateContent: {
    height: TOOLBAR_CONTROL_SIZE,
    justifyContent: 'center',
  },
  datePress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    height: TOOLBAR_CONTROL_SIZE,
    paddingHorizontal: SPACING.md,
  },
  dateText: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  spacer: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  statusSlot: {
    height: TOOLBAR_CONTROL_SIZE,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xs,
  },
  actionsOuter: {
    position: 'relative',
    zIndex: 40,
    flexShrink: 0,
  },
  qualitySegment: {
    height: TOOLBAR_CONTROL_SIZE,
    minWidth: TOOLBAR_CONTROL_SIZE,
    paddingHorizontal: SPACING.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qualityMenu: {
    position: 'absolute',
    top: '100%',
    minWidth: 132,
    borderWidth: 1,
    paddingVertical: 4,
    zIndex: 40,
    elevation: 8,
  },
  qualityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  qualityText: {
    fontSize: 11,
    fontWeight: '700',
  },
})
