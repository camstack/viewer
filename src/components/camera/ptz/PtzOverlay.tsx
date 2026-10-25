/**
 * PtzOverlay — the FULLSCREEN PTZ pad: the camera's own `PtzControls` (pad,
 * zoom, Home, presets) on a glass panel over the picture, opened by the PTZ
 * disc of the on-video cluster (operator, 2026-10-23: "PTZ controls in full
 * screen, as was done for the navigation, with a button to activate it").
 *
 * Not a second pad: the controls are `PtzControls`, the component the
 * timeline's PTZ panel, the cameras list sheet and the wall already mount, so every
 * press reaches the same `usePtz` action. This file adds only the surface
 * (`GlassPanel`, the floating-panel material) and the position
 * (`ptz-overlay-layout.ts`).
 *
 * Mounted by the camera screen only in `fill`, only for a camera the session
 * may steer, and only while the disc is on. Visibility follows the stream
 * controls (`visible` is the screen's `controlsVisible`): a tap on the picture
 * hides it with the discs, and the auto-hide takes it too. Every press on the
 * pad reports through `onInteract`, which restarts that countdown, so the
 * chrome never vanishes under a finger that is still steering.
 */
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useViewportSize } from '../../../hooks/use-viewport-size.js'
import { SPACING } from '../../../theme/tokens.js'
import { GlassPanel } from '../../ui/GlassPanel.js'
import { OVERLAY_DISC_SIZE, type OverlayEdgePad } from '../OverlayDiscGroup.js'
import { PtzControls } from '../PtzControls.js'
import { ptzOverlayLayout } from './ptz-overlay-layout.js'

export const PTZ_OVERLAY_TEST_ID = 'ptz-overlay'

export interface PtzOverlayProps {
  readonly deviceId: number
  /** The stream controls' visibility — the discs' flag, shared. */
  readonly visible: boolean
  /** The window safe-area, like the discs: fill mode reaches the notch. */
  readonly edgePad: OverlayEdgePad
  /** Every press on the pad — restarts the chrome's auto-hide. */
  readonly onInteract: () => void
}

export function PtzOverlay({ deviceId, visible, edgePad, onInteract }: PtzOverlayProps) {
  const { width, height } = useViewportSize()
  const insets = useSafeAreaInsets()

  if (!visible) return null

  const layout = ptzOverlayLayout({
    windowWidth: width,
    windowHeight: height,
    edgePad,
    topInset: insets.top,
    discSize: OVERLAY_DISC_SIZE,
  })

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID={PTZ_OVERLAY_TEST_ID}>
      <GlassPanel
        style={[
          styles.panel,
          { left: layout.left, bottom: layout.bottom, maxWidth: layout.maxWidth, maxHeight: layout.maxHeight },
        ]}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <PtzControls deviceId={deviceId} hasFeature onInteract={onInteract} />
        </ScrollView>
      </GlassPanel>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { position: 'absolute' },
  body: { padding: SPACING.lg },
})
