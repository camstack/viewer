/**
 * The playback bar's dropdowns — the speed menu and the overflow menu — and
 * WHERE they open.
 *
 * Web: portalled to the window (react-native-web's `Modal` renders into
 * `document.body`), placed by `placePopover` from the anchor's measured box,
 * opening upward and flipping down when there is no room above. Inside the
 * bar's own box no z-index can lift it over the timeline toolbar above, which
 * is an EARLIER sibling with its own higher rank — that is how the operator
 * got an empty sliver of menu poking out from under the header (2026-10-06).
 * A press anywhere outside closes it.
 *
 * Native: exactly what it was — an absolutely-positioned child of the anchor,
 * opening upward. A `Modal` there would bring the iOS orientation lock with
 * it (a Modal without `supportedOrientations` forces portrait), and the
 * report is the web layout's; changing native is a separate decision.
 */
import React, { useState, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
// ui-check-ok: a popover portalled to the window on the web (RNW's Modal), not a sheet
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'

import { SPACING } from '../../../theme/tokens.js'
import { GlassPanel } from '../../ui/GlassPanel.js'
import { useTimelineScale } from './TimelineScaleProvider.js'
import {
  placePopover,
  type PopoverDirection,
  type PopoverSize,
  type WindowRect,
} from './popover-placement.js'

export interface PlaybackBarPopoverProps {
  readonly open: boolean
  readonly onClose: () => void
  /** The chip the menu hangs off — measured in window coordinates on web. */
  readonly anchorRef: RefObject<View | null>
  /** The rows. Handed the direction the menu really opened in, because the
   *  rate list orders itself by it (`playbackRateMenuOrder`). */
  readonly children: (direction: PopoverDirection) => ReactNode
}

/** True where the menu is portalled to the window rather than drawn in the bar. */
export function popoverPortalled(): boolean {
  return Platform.OS === 'web'
}

export function PlaybackBarPopover(props: PlaybackBarPopoverProps): React.JSX.Element | null {
  if (!props.open) return null
  return popoverPortalled() ? <PortalledMenu {...props} /> : <InlineMenu {...props} />
}

function InlineMenu({ children }: PlaybackBarPopoverProps): React.JSX.Element {
  const ui = useTimelineScale()
  return (
    <GlassPanel
      radius={ui.radius.lg}
      // Below the menu, not above it: it opens UPWARD.
      style={[styles.inlineMenu, styles.menu, { marginBottom: ui.space.xs }]}
      accessibilityRole="menu"
    >
      {children('up')}
    </GlassPanel>
  )
}

function PortalledMenu({ onClose, anchorRef, children }: PlaybackBarPopoverProps): React.JSX.Element {
  const { t } = useTranslation()
  const ui = useTimelineScale()
  const viewport = useWindowDimensions()
  const [anchor, setAnchor] = useState<WindowRect | null>(null)
  const [size, setSize] = useState<PopoverSize | null>(null)

  // Measured once the portal has mounted: the anchor does not move while the
  // menu is open (the backdrop takes every press), so one read is the truth.
  const onPortalLayout = (): void => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height })
    })
  }

  const placement = anchor !== null && size !== null ? placePopover(anchor, size, viewport, 'up') : null
  const direction: PopoverDirection = placement?.direction ?? 'up'

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill} onLayout={onPortalLayout}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('v2.playback.closeMenu')}
        />
        <GlassPanel
          radius={ui.radius.lg}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout
            setSize((prev) => (prev?.width === width && prev.height === height ? prev : { width, height }))
          }}
          style={[
            styles.menu,
            styles.portalMenu,
            // Drawn invisibly until both boxes are known, so the first frame
            // never shows the menu at the window's corner.
            placement === null ? styles.unplaced : { left: placement.left, top: placement.top },
          ]}
          accessibilityRole="menu"
        >
          {children(direction)}
        </GlassPanel>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  menu: {
    minWidth: 84,
    paddingVertical: SPACING.xs,
  },
  inlineMenu: {
    position: 'absolute',
    // UPWARD. This bar sits at the bottom of the frame and the clip's progress
    // track is directly below the transport row, so a menu opening down lands
    // on top of the one control the operator is most likely reaching for —
    // and, on a clip, is the thing it was painting under.
    bottom: '100%',
    right: 0,
  },
  portalMenu: {
    position: 'absolute',
  },
  unplaced: {
    left: 0,
    top: 0,
    opacity: 0,
  },
})
