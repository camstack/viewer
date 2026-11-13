/**
 * CameraControlsOverlay — one button on the cameras list, one sheet: PTZ (when
 * the camera has it), navigation (a robot camera), and the camera's ACCESSORY
 * PANEL — linked devices with their controls, the local edit mode, and the
 * per-camera function switches (D62) — for ONE camera at a time.
 *
 * Every section is a component the single-camera screens already mount —
 * `PtzControls`, `NavigationControls`, `CameraAccessoryPanel` — reused
 * verbatim rather than re-implemented, the same discipline
 * `GridCellPanelOverlay` already established for the grid wall's own per-cell
 * menu. Until 2026-09-22 this sheet composed the devices list and the switch
 * group ITSELF, and the single-camera page composed the devices only: two
 * compositions of the same bricks. `CameraAccessoryPanel` is now the one
 * composition and this host adds nothing to it.
 *
 * ## Mounted once, body gated on a real camera
 *
 * The screen mounts exactly one instance (`CamerasScreen`), keyed by whichever
 * camera's button was last pressed. While no camera is selected — or the sheet
 * is closed — this returns `null` outright: no linked-devices query, no PTZ
 * probe, no switch-group fan-out for a sheet nobody is looking at, mirroring
 * `GridCellPanelOverlay`'s `panel === null` rule.
 *
 * ## PTZ is conditional, not merely disabled
 *
 * `PtzControls` on its own renders a disabled "not available" note when it has
 * no axes — correct INSIDE a panel already titled "PTZ", wrong as a section a
 * non-PTZ camera would still show. So this host does not mount the PTZ section
 * at all unless the camera advertises `pan-tilt-zoom` AND the session may
 * actuate, mirroring `CameraDetailScreen`'s `hasPtz`: hidden rather than
 * greyed, because a control the hub would refuse advertises a capability the
 * session does not have and offers nothing to do about it.
 */
import React, { memo } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { SheetModal } from '../ui/SheetModal.js'
import { Section } from '../ui/Section.js'
import { useCanActuate } from '../../hooks/use-user-scope.js'
import { FEATURE, type CameraInfo } from '../../data/use-cameras.js'
import { PtzControls } from './PtzControls.js'
import { NavigationControls } from './NavigationControls.js'
import { useDeviceCapNames } from '../../data/use-device-cap-names.js'
import { CameraAccessoryPanel } from './accessory-panel/CameraAccessoryPanel.js'
import { KeyboardAwareScrollView } from '../ui/KeyboardInset.js'

export interface CameraControlsOverlayProps {
  readonly visible: boolean
  /** The camera this sheet controls. `null` while none is selected — the
   *  sheet renders nothing in that case regardless of `visible`. */
  readonly camera: CameraInfo | null
  readonly onClose: () => void
}

export const CameraControlsOverlay = memo(function CameraControlsOverlay({
  visible,
  camera,
  onClose,
}: CameraControlsOverlayProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const canActuate = useCanActuate()

  const open = visible && camera !== null
  const deviceId = camera?.id ?? -1

  // A robot camera drives itself: its `navigation` cap is not a camera FEATURE
  // the list carries, so the bound cap names are asked (once per open).
  const { data: capNames = [] } = useDeviceCapNames(open ? deviceId : -1, open)

  if (!open || camera === null) return null

  const hasPtz = canActuate && camera.features.includes(FEATURE.ptz)
  const hasNavigation = canActuate && capNames.includes('navigation')

  return (
    <SheetModal
      visible
      onClose={onClose}
      backdropLabel={t('v2.cameraDetail.close')}
      sheetStyle={[styles.sheet, { backgroundColor: colors.backgroundElevated }]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {camera.name}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('v2.cameraDetail.close')}
          style={[styles.iconBtn, { backgroundColor: colors.surface }]}
        >
          <X size={18} color={colors.foreground} />
        </Pressable>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + SPACING.lg }]}
        // This panel may hold a text field (the accessory panel's inline
        // rename). The keyboard-aware scroll pads the content by the keyboard
        // and scrolls the focused field into view on iOS and Android; the
        // default `handled` taps keep every other control usable while it is up.
        keyboardDismissMode="interactive"
      >
        {/* PTZ — conditional on the camera advertising it (never an empty
            or disabled section for a camera without one). */}
        {hasPtz ? (
          <Section title={t('v2.cameraDetail.ptz')}>
            <View style={styles.sectionBody}>
              <PtzControls deviceId={camera.id} hasFeature={hasPtz} />
            </View>
          </Section>
        ) : null}

        {/* Navigation — a robot camera (its own cap, never PTZ in disguise). */}
        {hasNavigation ? (
          <Section title={t('v2.navigation.title')}>
            <View style={styles.sectionBody}>
              <NavigationControls deviceId={camera.id} hasCap={hasNavigation} />
            </View>
          </Section>
        ) : null}

        {/* The accessory panel — linked devices, the local edit mode and
            the function switches (D62) — the SAME composition the
            single-camera page and the wall mount. It draws its own section
            labels and owns its loading / empty states. */}
        <Section>
          <View style={styles.sectionBody}>
            <CameraAccessoryPanel deviceId={camera.id} cameraName={camera.name} />
          </View>
        </Section>
      </KeyboardAwareScrollView>
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
    gap: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  title: { flex: 1, fontSize: 18, fontWeight: '700' },
  iconBtn: { width: 32, height: 32, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  scroll: { gap: SPACING.lg, paddingVertical: SPACING.sm },
  sectionBody: { padding: SPACING.md },
})
