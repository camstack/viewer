/**
 * SheetModal — the ONE frame every sheet-style modal opens in.
 *
 * On a phone a sheet is a sheet: it slides up from the bottom edge, its card
 * spans the width, and a tap on the dimmed backdrop closes it. On the web (the
 * PWA and the hub-served viewer, at ANY window width) a bottom sheet reads as a
 * mobile layout that leaked onto a desktop: on a 1920 px window it is a strip
 * glued to the bottom edge, far from the pointer, as wide as the screen. So the
 * same sheet renders there as a CENTERED dialog — one switch, here, and never a
 * per-call-site `Platform.OS` check.
 *
 * What the frame owns, per presentation ({@link sheetPresentation}):
 *
 *  - `sheet` (iOS / Android): the card slides up while the backdrop, a
 *    separate full-screen layer, only fades (opacity, Reanimated); the Modal
 *    itself does not animate. Backdrop aligned to the bottom, the caller's
 *    card style verbatim.
 *  - `dialog` (web): `fade` animation, backdrop centring the card with a
 *    gutter, and the caller's card style overridden by {@link DIALOG_FRAME}:
 *    every corner rounded, a max width for a desktop and a max height for a
 *    short browser window, the overflow clipped so a scroll view inside the
 *    card scrolls WITHIN the dialog. Esc closes it (react-native-web calls
 *    `onRequestClose` on Escape) and focus is trapped inside the modal; the card
 *    is rendered BEFORE the backdrop's tap target so the first focusable control
 *    is the card's own, not the invisible "close" area behind it.
 *
 *  - the keyboard (iOS / Android): the card is lifted above the software
 *    keyboard by `KeyboardInsetView` — always, no opt-in. A card whose content
 *    can outgrow what is left above the keyboard wraps that content in a
 *    `KeyboardAwareScrollView`, which also scrolls the focused field into view.
 *
 * What it does not own: the card's content, colours and padding — the caller's,
 * through `children` and `sheetStyle`.
 */
import React, { useEffect, useState } from 'react'
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { RADIUS } from '../../theme/tokens.js'
import { KeyboardInsetView } from './KeyboardInset.js'
import {
  clampDrag,
  DRAG_ACTIVATION,
  DRAG_ZONE_HEIGHT,
  dragScrimFactor,
  shouldCloseOnRelease,
} from './sheet-drag.js'

/** How a sheet is presented on a platform. */
export type SheetPresentation = 'sheet' | 'dialog'

/** The platforms a sheet can open on (`Platform.OS`'s values). */
export type SheetPlatformOS = 'ios' | 'android' | 'web' | 'windows' | 'macos'

/** The one decision: a dialog on the web, a bottom sheet everywhere else. */
export function sheetPresentation(os: SheetPlatformOS): SheetPresentation {
  return os === 'web' ? 'dialog' : 'sheet'
}

/** Widest a dialog grows on a desktop window, px. */
export const DIALOG_MAX_WIDTH = 560
/** Gutter between a dialog and the window edge, px — what is left of the
 *  backdrop on a narrow browser window. */
export const DIALOG_GUTTER = 16
/** Tallest a dialog grows, as a share of the window. The remainder keeps the
 *  backdrop visible above and below, so it still reads as dismissible. */
export const DIALOG_MAX_HEIGHT = '90%'

/** The web card frame, applied OVER the caller's sheet style. */
export const DIALOG_FRAME: ViewStyle = {
  width: '100%',
  maxWidth: DIALOG_MAX_WIDTH,
  maxHeight: DIALOG_MAX_HEIGHT,
  borderRadius: RADIUS.xl,
  borderTopLeftRadius: RADIUS.xl,
  borderTopRightRadius: RADIUS.xl,
  borderBottomLeftRadius: RADIUS.xl,
  borderBottomRightRadius: RADIUS.xl,
  overflow: 'hidden',
  // A sheet card is often absolutely pinned to the bottom edge on native
  // (`left/right/bottom: 0`). Relative positioning turns those zero offsets
  // into no-ops, so the backdrop's centring wins.
  position: 'relative',
  zIndex: 1,
  // ui-check-ok: dialog shadow is theme-independent (pre-existing)
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
}

/** The backdrop layout for a presentation. */
export function sheetBackdropStyle(presentation: SheetPresentation): ViewStyle {
  return presentation === 'dialog'
    ? { flex: 1, justifyContent: 'center', alignItems: 'center', padding: DIALOG_GUTTER }
    : { flex: 1, justifyContent: 'flex-end' }
}

/**
 * The Modal's own animation for a presentation. A phone sheet animates itself
 * (`none` here): the Modal's `slide` moves EVERYTHING inside it, so the dimmed
 * backdrop rode up with the card instead of fading in place.
 */
export function sheetAnimation(presentation: SheetPresentation): 'none' | 'fade' {
  return presentation === 'dialog' ? 'fade' : 'none'
}

/** Open/close duration of a phone sheet, ms. */
export const SHEET_ANIMATION_MS = 240

/** The backdrop follows the open progress `0..1` with opacity ONLY — it never moves. */
export function scrimOpacity(progress: number): number {
  'worklet'
  return progress
}

/** The card travels its own height while the progress goes `1 -> 0`. */
export function cardTranslateY(progress: number, cardHeight: number): number {
  'worklet'
  return (1 - progress) * cardHeight
}

// ui-check-ok: modal scrim; no scrim token in tokens.ts yet (pre-existing)
const DEFAULT_SCRIM = 'rgba(0,0,0,0.5)'

export interface SheetModalProps {
  readonly visible: boolean
  /** Back gesture, Esc on the web, and (unless overridden) a backdrop tap. */
  readonly onClose: () => void
  /** The card. */
  readonly children: React.ReactNode
  /** The card's own style — background, padding, radii, height cap. */
  readonly sheetStyle?: StyleProp<ViewStyle>
  /** Backdrop dim. */
  readonly scrimColor?: string
  /** A backdrop tap; defaults to `onClose`. A sheet with a text field uses it
   *  to drop the keyboard before closing. */
  readonly onBackdropPress?: () => void
  /** Accessible name of the backdrop's close target. */
  readonly backdropLabel?: string
  /** testID of the card. */
  readonly testID?: string
}

export function SheetModal({
  visible,
  onClose,
  children,
  sheetStyle,
  scrimColor = DEFAULT_SCRIM,
  onBackdropPress,
  backdropLabel,
  testID,
}: SheetModalProps): React.JSX.Element {
  const presentation = sheetPresentation(Platform.OS)
  const isDialog = presentation === 'dialog'
  const { height: windowHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  // Open progress 0..1 of a phone sheet: drives the backdrop's opacity and the
  // card's travel, as two separate layers. The Modal stays mounted until the
  // close animation has finished.
  const progress = useSharedValue(0)
  const cardHeight = useSharedValue(windowHeight)
  // Finger travel of a drag-down; the backdrop reads it for opacity, never position.
  const dragY = useSharedValue(0)
  const touchStartY = useSharedValue(0)
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (isDialog) return
    if (visible) {
      dragY.value = 0
      setMounted(true)
      progress.value = withTiming(1, { duration: SHEET_ANIMATION_MS })
    } else {
      progress.value = withTiming(0, { duration: SHEET_ANIMATION_MS }, (finished) => {
        if (finished) runOnJS(setMounted)(false)
      })
    }
  }, [visible, isDialog, progress, dragY])

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: scrimOpacity(progress.value) * dragScrimFactor(dragY.value, cardHeight.value),
  }))
  const cardAnimated = useAnimatedStyle(() => ({
    transform: [{ translateY: cardTranslateY(progress.value, cardHeight.value) + dragY.value }],
  }))

  // The drag may only start in the card's top strip, so a ScrollView inside the
  // sheet keeps every touch below it. Activation is manual: a tap or a sideways
  // swipe in the strip fails the gesture instead of being swallowed.
  const closeDrag = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e, manager) => {
      const y = e.allTouches[0]?.y ?? 0
      touchStartY.value = y
      if (y > DRAG_ZONE_HEIGHT) manager.fail()
    })
    .onTouchesMove((e, manager) => {
      const touch = e.allTouches[0]
      if (touch === undefined) return
      if (touch.y - touchStartY.value > DRAG_ACTIVATION) manager.activate()
    })
    .onUpdate((e) => {
      dragY.value = clampDrag(e.translationY)
    })
    .onEnd((e) => {
      if (shouldCloseOnRelease(dragY.value, e.velocityY, cardHeight.value)) {
        runOnJS(onClose)()
      } else {
        dragY.value = withSpring(0)
      }
    })

  const card = isDialog ? (
    <View testID={testID} role="dialog" aria-modal style={[sheetStyle, DIALOG_FRAME]}>
      {children}
    </View>
  ) : (
    <GestureDetector gesture={closeDrag}>
      <Animated.View
        testID={testID}
        style={[sheetStyle, cardAnimated]}
        onLayout={(e) => {
          cardHeight.value = e.nativeEvent.layout.height
        }}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  )
  const scrimPress = (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={onBackdropPress ?? onClose}
      accessibilityRole="button"
      accessibilityLabel={backdropLabel}
      // Not a tab stop on the web: Esc already closes the dialog, and the
      // invisible backdrop must not be where focus lands first.
      tabIndex={isDialog ? -1 : undefined}
    />
  )
  const scrim = isDialog ? (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor }]}>{scrimPress}</View>
  ) : (
    <Animated.View
      testID={testID === undefined ? undefined : `${testID}-scrim`}
      style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor }, scrimStyle]}
    >
      {scrimPress}
    </Animated.View>
  )
  // Native keeps the scrim first so the card paints over it; the dialog puts
  // the card first (focus order) and lifts it with `zIndex` instead.
  const content = isDialog ? (
    <>
      {card}
      {scrim}
    </>
  ) : (
    <>
      {scrim}
      {card}
    </>
  )
  const backdrop = sheetBackdropStyle(presentation)
  // A phone sheet always keeps its card above the software keyboard — every
  // sheet, picker and dialog built on this frame, whether or not its caller
  // thought of it (Library -> Plates opened under the keyboard). The backdrop
  // is full-window and never moves, so it is what is measured; the card,
  // bottom-aligned, rides up by the overlap and stops below the status bar.
  // Content taller than what is left scrolls in a `KeyboardAwareScrollView`.
  const body = isDialog ? (
    <View style={backdrop}>{content}</View>
  ) : (
    <KeyboardInsetView
      testID={testID === undefined ? undefined : `${testID}-backdrop`}
      style={backdrop}
      safeTopWhenLifted={insets.top}
    >
      {content}
    </KeyboardInsetView>
  )

  return (
    <Modal
      visible={isDialog ? visible : mounted}
      animationType={sheetAnimation(presentation)}
      transparent
      onRequestClose={onClose}
    >
      {/* A Modal is a separate native window outside the app's gesture root. */}
      {isDialog ? body : <GestureHandlerRootView style={styles.root}>{body}</GestureHandlerRootView>}
    </Modal>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })
