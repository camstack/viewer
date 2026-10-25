/**
 * TimelinePanelHost — the frame a panel wears when it TAKES OVER the timeline
 * body.
 *
 * The panels here (filter, date, capture actions, export) used to be overlays:
 * a bar floated above the FAB stack, two were `Modal`s, one was a `FloatingPanel`
 * anchored to an animated offset the screen computed from the video box height.
 * Every one of them had to be told where the space it could use began and
 * ended, and each was re-tuned when a surface changed shape.
 *
 * A panel that OWNS the body works in every condition by construction: it is a
 * flex child filling what the column gave the body, with the toolbar, the
 * playback bar and the footer still docked around it. Nothing is covered, so
 * nothing has to be positioned around what it covers.
 *
 * The way back is the panel's own header — a title and a close button — because
 * the affordance that dismissed the old overlays (tap outside, or the toolbar
 * button that opened it) is not visible on a surface that fills the body.
 *
 * Panels reached FROM another panel (storage / event-store, both opened out
 * of the view-options menu) additionally carry `onBack`: a leading
 * chevron that returns to the opener. Panels opened directly from the toolbar
 * must NOT pass it — there is nothing behind them to go back to, and a chevron
 * that closes would teach the operator the wrong gesture.
 */
import React from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, X } from '../../../lib/icons.js'

import { useTheme } from '../../../theme/theme-provider.js'
import { useTimelineScale } from './TimelineScaleProvider.js'
import { KeyboardAwareScrollView } from '../../ui/KeyboardInset.js'

export interface TimelinePanelHostProps {
  readonly title: string
  readonly onClose: () => void
  /** Return to the panel this one was opened FROM. Only for panels reached
   *  from another panel — absent on toolbar-opened panels. */
  readonly onBack?: () => void
  /** Set false when the panel body scrolls itself and manages its own padding
   *  (the cluster detail, whose track picker and media gallery both scroll). */
  readonly scroll?: boolean
  /** False while a child (export heatmap) owns the finger, so the scroller
   *  cannot steal a horizontal scrub. */
  readonly scrollEnabled?: boolean
  readonly children: React.ReactNode
}

export function TimelinePanelHost({
  title,
  onClose,
  onBack,
  scroll = true,
  scrollEnabled = true,
  children,
}: TimelinePanelHostProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ui = useTimelineScale()

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            borderBottomColor: colors.border,
            paddingHorizontal: ui.space.lg,
            paddingVertical: ui.space.md,
            gap: ui.space.md,
          },
        ]}
      >
        {onBack !== undefined ? (
          <Pressable
            onPress={onBack}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('v2.common.back')}
            style={({ pressed }) => [
              styles.close,
              {
                width: ui.control.button,
                height: ui.control.button,
                borderRadius: ui.radius.lg,
                backgroundColor: colors.surfaceHover,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <ChevronLeft size={ui.icon.sm} color={colors.foregroundMuted} />
          </Pressable>
        ) : null}
        <Text
          style={[styles.title, { color: colors.foreground, fontSize: ui.font.md }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('v2.cameraDetail.close')}
          style={({ pressed }) => [
            styles.close,
            {
              width: ui.control.button,
              height: ui.control.button,
              borderRadius: ui.radius.lg,
              backgroundColor: colors.surfaceHover,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <X size={ui.icon.sm} color={colors.foregroundMuted} />
        </Pressable>
      </View>

      {scroll ? (
        <KeyboardAwareScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator
          scrollEnabled={scrollEnabled}
          // This panel may hold a text field (the accessory panel's inline
          // rename). The keyboard-aware scroll pads the content by the keyboard
          // and scrolls the focused field into view on iOS and Android; the
          // default `handled` taps keep every other control usable while it is up.
          keyboardDismissMode="interactive"
        >
          <View style={[styles.body, { padding: ui.space.lg, gap: ui.space.lg }]}>{children}</View>
        </KeyboardAwareScrollView>
      ) : (
        <View style={styles.scroll}>{children}</View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  title: {
    flex: 1,
    fontWeight: '700',
  },
  close: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  body: {
    flexGrow: 1,
  },
})
