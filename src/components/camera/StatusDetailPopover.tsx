/**
 * The popover behind the battery and link glyphs — what turns two mute icons
 * into something you can ask a question of.
 *
 * ## Why it is not a modal
 *
 * The place it matters most is the theater toolbar in LANDSCAPE, where that bar
 * lives inside the timeline drawer over the picture. A full-screen sheet there
 * covers the very stream you opened the popover to keep watching. So this is an
 * anchored layer: a small card, a transparent backdrop that closes it, and no
 * navigation.
 *
 * ## How it stays on screen (the landscape problem)
 *
 * It takes **no width of its own**. The card is an absolutely positioned child
 * of the HOST box — the toolbar's own container, the card's own media area —
 * inset by `SPACING.md` on both sides and right-aligned inside that. Its
 * horizontal bounds are therefore the host's, by construction: inside the
 * drawer it can never be wider than the drawer (`drawerWidth()`, at most 340pt
 * and as little as 240), and no window measurement, no `onLayout` latch and no
 * second occupancy constant can drift out of agreement with it. This is why the
 * host mounts the popover itself rather than the badge carrying it: a badge is
 * 14pt wide and anything anchored to it would hang off the edge of a phone in
 * landscape, or be clipped by the card's `overflow: hidden`.
 *
 * Vertically the two hosts differ, hence `placement`:
 *   - `below` — hangs under the toolbar, over the timeline body. The toolbar
 *     container is `zIndex: 20`, above the fault (10) and history (9) notices
 *     and the playback bar's own dropdown (15), so the layer is not covered by
 *     the panel it hangs over;
 *   - `insideBottom` — sits at the bottom of a camera card's picture, directly
 *     above the footer that holds the glyphs. The card clips (`overflow:
 *     hidden`), so a layer that left the card would simply be invisible.
 *
 * ## One layer, one owner
 *
 * `useStatusDetail` holds a single subject, so opening the link detail closes
 * the battery one instead of stacking two cards. The badge itself keeps its
 * speaking label (the figures are IN the `accessibilityLabel`), so a
 * screen-reader user learns the values without opening anything.
 */
import React, { useCallback, useState } from 'react'
import { View, Text, Pressable, StyleSheet, type GestureResponderEvent } from 'react-native'
import { useTranslation } from 'react-i18next'

import { SPACING, TYPOGRAPHY, type ColorTokens } from '../../theme/tokens.js'
import { hapticTap } from '../../lib/haptics.js'
import type { BatteryStatus } from '../../data/use-battery.js'
import type { NetworkLinkStatus } from '../../data/use-network-link.js'
import {
  batteryDetailLines,
  networkLinkDetailLines,
  STATUS_DETAIL_KEY,
  streamDetailLines,
  type StatusDetailLine,
} from './status-detail-lines.js'
import { useStreamDebugStore } from '../../store/stream-debug-store.js'
import { GlassPanel } from '../ui/GlassPanel.js'

export const STATUS_DETAIL_CARD_TEST_ID = 'status-detail-card'
export const STATUS_DETAIL_BACKDROP_TEST_ID = 'status-detail-backdrop'

/** The glyphs are small. This is what makes them hittable by a thumb. */
const BADGE_HIT_SLOP = 10

/**
 * How far the backdrop reaches beyond the host box. A tap anywhere it covers
 * closes the layer. It cannot cover the whole window from inside a host — RN
 * has no portal — and on Android a touch outside the parent's bounds is not
 * delivered at all, so there the reach is the host. Pressing the badge again
 * closes it everywhere, which is the guaranteed way out.
 */
const BACKDROP_REACH = 2000

/**
 * Which detail the card is open on.
 *
 * `stream` exists because the other two are not always THERE: a wired camera
 * with no battery and no link report shows neither glyph, and the card — which
 * is now where the stream numbers live — had no way to be opened at all. So a
 * camera with neither gets one glyph of its own.
 */
export type StatusDetailSubject = 'battery' | 'link' | 'stream'

export interface StatusDetailController {
  readonly subject: StatusDetailSubject | null
  readonly toggle: (subject: StatusDetailSubject) => void
  readonly close: () => void
}

/** One open layer per host. */
export function useStatusDetail(): StatusDetailController {
  const [subject, setSubject] = useState<StatusDetailSubject | null>(null)
  const toggle = useCallback((next: StatusDetailSubject) => {
    setSubject((current) => (current === next ? null : next))
  }, [])
  const close = useCallback(() => { setSubject(null) }, [])
  return { subject, toggle, close }
}

/** Each subject's card heading — and the badge's spoken name. */
const SUBJECT_TITLE: Readonly<Record<StatusDetailSubject, string>> = {
  battery: STATUS_DETAIL_KEY.batteryTitle,
  link: STATUS_DETAIL_KEY.linkTitle,
  stream: STATUS_DETAIL_KEY.streamTitle,
}

export interface StatusBadgeButtonProps {
  readonly subject: StatusDetailSubject
  /** The same lines the popover will show — they become the spoken label. */
  readonly lines: readonly StatusDetailLine[]
  readonly controller: StatusDetailController
  readonly children?: React.ReactNode
}

/** Makes a glyph pressable and speaking, without changing how it draws. */
export function StatusBadgeButton({
  subject,
  lines,
  controller,
  children,
}: StatusBadgeButtonProps): React.JSX.Element {
  const { t } = useTranslation()
  const title = t(SUBJECT_TITLE[subject])
  const spoken = lines
    .map((line) => `${t(line.labelKey)}: ${line.kind === 'text' ? line.text : t(line.valueKey)}`)
    .join(', ')
  return (
    <Pressable
      // The card in the cameras list is itself a Pressable that navigates: a
      // tap on the glyph must open the detail, not the camera.
      onPress={(event: GestureResponderEvent) => {
        event.stopPropagation()
        hapticTap()
        controller.toggle(subject)
      }}
      hitSlop={BADGE_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${spoken}`}
      accessibilityState={{ expanded: controller.subject === subject }}
    >
      {children}
    </Pressable>
  )
}

export type StatusDetailPlacement = 'below' | 'insideBottom'

export interface StatusDetailPopoverProps {
  readonly controller: StatusDetailController
  readonly battery?: BatteryStatus | null
  readonly link?: NetworkLinkStatus | null
  /**
   * The camera this card belongs to. Given it, the card also shows the STREAM
   * section — the numbers the player reported for this device.
   *
   * There is no toggle for it: the in-picture overlay cannot be opened on a
   * phone (the WebView's touches belong to the RN gesture layer), so this card
   * is where those numbers are reachable, and a debug panel you have to switch
   * on somewhere else is one nobody finds while a stream is misbehaving.
   */
  readonly deviceId?: number
  readonly colors: ColorTokens
  readonly placement: StatusDetailPlacement
}

export function StatusDetailPopover({
  controller,
  battery,
  link,
  deviceId,
  colors,
  placement,
}: StatusDetailPopoverProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { subject } = controller
  // Subscribed unconditionally — hooks cannot sit behind the early return
  // below, and an absent device simply selects nothing.
  const streamSample = useStreamDebugStore((state) =>
    deviceId === undefined ? null : (state.samples[deviceId] ?? null),
  )
  if (subject === null) return null

  // Narrowed per subject rather than cast: the two statuses share no shape, and
  // a status the host did not supply draws nothing.
  const lines: readonly StatusDetailLine[] | null =
    subject === 'stream'
      ? // The stream block below IS this subject's content; there is no
        // second list to draw above it.
        []
      : subject === 'battery'
        ? battery === null || battery === undefined
          ? null
          : batteryDetailLines(battery)
        : link === null || link === undefined
          ? null
          : networkLinkDetailLines(link)
  if (lines === null) return null
  const title = t(subject === 'battery' ? STATUS_DETAIL_KEY.batteryTitle : STATUS_DETAIL_KEY.linkTitle)

  return (
    <>
      <Pressable
        style={styles.backdrop}
        onPress={(event: GestureResponderEvent) => {
          event.stopPropagation()
          controller.close()
        }}
        testID={STATUS_DETAIL_BACKDROP_TEST_ID}
        accessibilityLabel={t('v2.statusDetail.close')}
      />
      <View
        style={[styles.anchor, placement === 'below' ? styles.below : styles.insideBottom]}
      >
        <GlassPanel
          style={styles.card}
          testID={STATUS_DETAIL_CARD_TEST_ID}
          // Announced as soon as it appears: the layer is the answer to the tap.
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.title, { color: colors.foregroundMuted }]}>{title}</Text>
          {lines.map((line, index) => (
            <View key={`${line.labelKey}-${String(index)}`} style={styles.row}>
              <Text style={[styles.label, { color: colors.foregroundMuted }]} numberOfLines={1}>
                {t(line.labelKey)}
              </Text>
              <Text style={[styles.value, { color: colors.foreground }]} numberOfLines={2}>
                {line.kind === 'text' ? line.text : t(line.valueKey)}
              </Text>
            </View>
          ))}
          {deviceId !== undefined && (
            <>
              {subject !== 'stream' && (
                <Text
                  style={[styles.title, styles.sectionTitle, { color: colors.foregroundMuted }]}
                >
                  {t(STATUS_DETAIL_KEY.streamTitle)}
                </Text>
              )}
              {streamDetailLines(streamSample).map((line, index) => (
                <View key={`stream-${line.labelKey}-${String(index)}`} style={styles.row}>
                  <Text
                    style={[styles.label, { color: colors.foregroundMuted }]}
                    numberOfLines={1}
                  >
                    {t(line.labelKey)}
                  </Text>
                  <Text style={[styles.value, { color: colors.foreground }]} numberOfLines={2}>
                    {line.kind === 'text' ? line.text : t(line.valueKey)}
                  </Text>
                </View>
              ))}
            </>
          )}
        </GlassPanel>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: -BACKDROP_REACH,
    bottom: -BACKDROP_REACH,
    left: -BACKDROP_REACH,
    right: -BACKDROP_REACH,
    zIndex: 39,
  },
  anchor: {
    position: 'absolute',
    // The wrapper is a lane, not a surface: taps pass through to the backdrop.
    pointerEvents: 'box-none',
    // The host's own box is the width budget — see the header.
    left: SPACING.md,
    right: SPACING.md,
    alignItems: 'flex-end',
    // Over the toolbar's own dropdowns' neighbours; the container it lives in
    // already out-ranks the timeline body.
    zIndex: 40,
  },
  below: { top: '100%', marginTop: SPACING.xs },
  insideBottom: { bottom: SPACING.md },
  card: {
    maxWidth: '100%',
    minWidth: 150,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    gap: SPACING.xs,
  },
  title: {
    fontSize: TYPOGRAPHY.size.xs,
    fontWeight: TYPOGRAPHY.weight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.xs,
  },
  /** The stream block sits under whichever subject was opened, not beside it. */
  sectionTitle: {
    marginTop: SPACING.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.lg,
  },
  label: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.regular },
  value: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.bold, flexShrink: 1, textAlign: 'right' },
})
