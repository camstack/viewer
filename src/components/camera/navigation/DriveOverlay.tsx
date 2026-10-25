/**
 * DriveOverlay — the LANDSCAPE drive chrome for a robot camera: the joystick
 * bottom-left, four round buttons bottom-right (Stop · fill light · Follow
 * me · Return to dock) and a fifth "…" that opens the existing controls
 * panel — the same panel the toolbar chip toggles, never a second one
 * (operator, 2026-09-06: joystick + four buttons in landscape overlay).
 *
 * Mounted by the camera screen only in `fill`, only for a camera bound to
 * `navigation`, and only while the stream is playing: the robot moves only
 * with its monitor open, so a stick over a poster would drive nothing.
 *
 * Visibility follows the stream controls (`visible` is the screen's
 * `controlsVisible`, the discs' own flag) with ONE exception: the overlay
 * never hides while the thumb is down. Auto-hide firing mid-drive would
 * pull the ring out from under the finger, and the gesture would finalize
 * on an unmounted detector.
 *
 * Every button is the cap's own data: the two action buttons exist only
 * when `listActions` lists the action for THIS device, and take its label.
 *
 * Against the landscape drawer (`drawer`): the joystick stays where it is,
 * the cluster moves to the picture still visible and its discs shrink to
 * fit (`drive-overlay-layout.ts`), and the "…" is dropped — the drawer's
 * own toolbar already carries the control that opens the panel.
 */
import React, { useCallback, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useViewportSize } from '../../../hooks/use-viewport-size.js'
import { useTranslation } from 'react-i18next'
import { Footprints, Home, Lightbulb, MoreHorizontal, Square } from '../../../lib/icons.js'
import { SPACING } from '../../../theme/tokens.js'
import { useNavigation } from '../../../data/use-navigation.js'
import { actionEntry, type NavigationEntry } from '../../../data/navigation-controls.js'
import { OVERLAY_DISC_SIZE, OverlayDiscButton, type OverlayEdgePad } from '../OverlayDiscGroup.js'
import { DRIVE_JOYSTICK_SIZE, DriveJoystick } from './DriveJoystick.js'
import { driveOverlayLayout, type DriveDrawerState } from './drive-overlay-layout.js'

export const DRIVE_OVERLAY_TEST_ID = 'drive-overlay'

export interface DriveOverlayProps {
  readonly deviceId: number
  /** The stream controls' visibility — the discs' flag, shared. */
  readonly visible: boolean
  /** The window safe-area, like the discs: fill mode reaches the notch. */
  readonly edgePad: OverlayEdgePad
  /** Opens the timeline's controls panel — the toolbar chip's own toggle. */
  readonly onOpenControls: () => void
  /** The landscape timeline drawer: while open it covers the right `width`. */
  readonly drawer?: DriveDrawerState
}

export function DriveOverlay({ deviceId, visible, edgePad, onOpenControls, drawer }: DriveOverlayProps) {
  const { t } = useTranslation()
  const { width: windowWidth } = useViewportSize()
  const nav = useNavigation(deviceId, true)
  const [engaged, setEngaged] = useState(false)
  const onEngage = useCallback(() => setEngaged(true), [])
  const onRelease = useCallback(() => {
    setEngaged(false)
    nav.stopDrive()
  }, [nav])

  if (!visible && !engaged) return null

  const lightOn = nav.status?.flash === true
  const follow = actionEntry(nav.actions, 'personFollow')
  const dock = actionEntry(nav.actions, 'goHome')
  const stopAction = actionEntry(nav.actions, 'stop')
  // The drawer's toolbar has its own way into the panel: no second one.
  const showMore = drawer?.open !== true
  const buttonCount =
    1 + (nav.features?.light ? 1 : 0) + (follow ? 1 : 0) + (dock ? 1 : 0) + (showMore ? 1 : 0)
  const layout = driveOverlayLayout({
    windowWidth,
    edgePad,
    drawer,
    discSize: OVERLAY_DISC_SIZE,
    joystickSize: DRIVE_JOYSTICK_SIZE,
    buttonCount,
  })
  const size = layout.discSize
  // Above the disc row, which owns the bottom edge.
  const bottom = edgePad.bottom + SPACING.md + OVERLAY_DISC_SIZE + SPACING.lg

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID={DRIVE_OVERLAY_TEST_ID}>
      <View style={[styles.stick, { left: edgePad.left + SPACING.md, bottom }]}>
        <DriveJoystick onVector={nav.driveVector} onRelease={onRelease} onEngage={onEngage} />
      </View>
      <View style={[styles.buttons, { right: layout.right, bottom, gap: layout.gap }]} pointerEvents="box-none">
        <OverlayDiscButton
          size={size}
          icon={Square}
          label={driveButtonLabel(stopAction, t('v2.navigation.stop'))}
          onPress={() => {
            nav.stopDrive()
            if (stopAction) nav.runAction('stop')
          }}
        />
        {nav.features?.light ? (
          <OverlayDiscButton
            size={size}
            icon={Lightbulb}
            label={lightOn ? t('v2.navigation.lightOff') : t('v2.navigation.lightOn')}
            active={lightOn}
            onPress={() => nav.setLightOn(!lightOn)}
          />
        ) : null}
        {follow ? (
          <OverlayDiscButton
            size={size}
            icon={Footprints}
            label={driveButtonLabel(follow, t('v2.navigation.followMe'))}
            active={nav.status?.following === true}
            onPress={() => nav.runAction('personFollow')}
          />
        ) : null}
        {dock ? (
          <OverlayDiscButton
            size={size}
            icon={Home}
            label={driveButtonLabel(dock, t('v2.navigation.returnToDock'))}
            onPress={() => nav.runAction('goHome')}
          />
        ) : null}
        {showMore ? (
          <OverlayDiscButton
            size={size}
            icon={MoreHorizontal}
            label={t('v2.navigation.moreControls')}
            onPress={onOpenControls}
          />
        ) : null}
      </View>
    </View>
  )
}

/** The cap's own label where the dictionary has the row, else the app's. */
function driveButtonLabel(entry: NavigationEntry | undefined, fallback: string): string {
  return entry?.label ?? fallback
}

const styles = StyleSheet.create({
  stick: { position: 'absolute' },
  buttons: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
  },
})
