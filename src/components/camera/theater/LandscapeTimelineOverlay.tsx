/**
 * LandscapeTimelineOverlay — the collapsible timeline PANEL for the
 * landscape (fill) camera view.
 *
 * Landscape used to unmount the WHOLE timeline. This brings it back as a
 * RIGHT-EDGE DRAWER over the video. The closed-state trigger is NOT here:
 * it is a left-cluster item of `OverlayDiscGroup`, so it hides with mute
 * and talk. This file owns the panel and the slide only.
 *
 * `open` is parent-owned (`landscapeDrawerOpen` on the detail screen). The
 * same flag hides overlay play/pause while the drawer's playback bar is
 * on screen.
 *
 * The slide is a plain Reanimated translateX on the UI thread — no layout
 * thrash — and the timeline stays MOUNTED while closed, so reopening restores
 * scroll position and playback state instantly.
 */
import React, { useEffect } from 'react'
import { useSettings } from '../../../data/use-settings.js'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { useViewportSize } from '../../../hooks/use-viewport-size.js'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { drawerPanelBox, DRAWER_OVERLAY_Z } from './landscape-drawer-geometry.js'
import { TimelineScaleProvider } from './TimelineScaleProvider.js'
import { log } from '../../../lib/logger.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { MOTION, timingTo, useReducedMotion } from '../../../theme/motion.js'

export interface LandscapeTimelineOverlayProps {
  readonly children: React.ReactNode
  /** Parent-owned. The playback bar rides in this drawer. */
  readonly open: boolean
  /**
   * BESIDE the stream (`timeline-dock` `side`) instead of over it: nothing is
   * behind the panel but the screen, so it paints the page background rather
   * than the translucent scrim that lets the picture show through.
   */
  readonly beside?: boolean
}

export function LandscapeTimelineOverlay({
  children,
  open,
  beside = false,
}: LandscapeTimelineOverlayProps) {
  const { colors } = useTheme()
  // See TheaterTimeline: the operator's toolbar height rides the same scale.
  const toolbarDensity = useSettings().settings.stream.toolbarDensity
  const { width: winW } = useViewportSize()
  const insets = useSafeAreaInsets()
  // ONE derivation for the panel box. The PANEL reserves no horizontal
  // safe-area inset (both earlier shapes left the rightmost strip of the drawer
  // as scrim with nothing drawn on it, which on a notched phone reads as a
  // black band down the edge of the video, reported three rounds running).
  const box = drawerPanelBox(winW)
  const panelW = box.panelWidth
  const slide = useSharedValue<number>(0) // 0 = closed, 1 = open
  const reduced = useReducedMotion()

  useEffect(() => {
    log.debug('theater', 'landscape-timeline: mounted', {
      windowWidth: winW,
      panelWidth: panelW,
      contentWidth: box.contentWidth,
    })
  }, [winW, panelW, box.contentWidth])

  useEffect(() => {
    log.debug('theater', 'landscape-timeline: toggled', { open })
  }, [open])

  useEffect(() => {
    slide.set(timingTo(open ? 1 : 0, MOTION.sheet.ms, reduced))
  }, [open, slide, reduced])

  // Closed = pushed fully off the right edge; open = flush with it.
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - slide.get()) * panelW }] }))

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.root]}>
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[
          styles.panel,
          {
            width: panelW,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
          beside ? { backgroundColor: colors.background, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 } : null,
          slideStyle,
        ]}
      >
        {/* Everything inside sizes itself from the width the panel actually has
            — which IS the panel, since nothing is reserved. Without this the
            chrome renders at full-screen size inside a ~317pt panel and swamps
            it, which no amount of narrowing the panel fixes. */}
        <TimelineScaleProvider availableWidth={box.contentWidth} density={toolbarDensity}>
          {children}
        </TimelineScaleProvider>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  /**
   * MUST out-rank the STREAM SLOT (z 50, `stream-slot.ts`). In fill mode the
   * picture is an opaque black box over the whole window, and a sibling without
   * a zIndex paints UNDER it — this overlay was once mounted and then covered
   * by the video. The relation is asserted in `landscape-drawer-geometry.spec`,
   * not left to two literals in two files.
   */
  root: {
    zIndex: DRAWER_OVERLAY_Z,
    elevation: DRAWER_OVERLAY_Z,
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(8, 10, 14, 0.72)', // ui-check-ok: scrim over the camera picture — dark in both themes (pre-existing)
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    overflow: 'hidden',
  },
})
