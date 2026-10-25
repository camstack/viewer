/**
 * TimelineClipIncompleteNotice — "the camera cut this clip short" (D623).
 *
 * > *"Se cade la sessione cade non fa niente, magari mostriamo un errore dove
 * > mostriamo anche l'errore di stream."* — the operator, 2026-09-24.
 *
 * ## Where it is, and why here
 *
 * In the chrome stack under the playback bar, directly beneath
 * {@link TimelineFaultNotice} — which is where this screen already says the
 * stream is in trouble, and therefore where the operator was told to look. The
 * band borrows that grammar to the letter: same hairline, same scale tokens,
 * same alert triangle in `danger`, so the two read as one stack rather than as
 * a second visual language for one subject (the whole reason `timeline-faults`
 * was written).
 *
 * ## Why it is NOT a row of that band
 *
 * Every row of the fault notice carries a retry chip, and this one must not.
 * There is nothing to retry into: the bytes are already at the peer, and a
 * second dial would contend for the camera's single replay lane at exactly the
 * moment that lane is already failing — the provider answers it with `a replay
 * was refused, the camera's slot is held`. A chip that must not be pressed is
 * a control that is not one (D62). The operator was asked and chose being told
 * over being retried.
 *
 * Nor is it dismissable. A dismissal is bookkeeping for something that
 * persists until it recovers; this sentence is about one replay that is
 * already over, and it goes on its own the moment the operator asks the camera
 * for anything else (`use-clip-stage.ts`).
 *
 * ## Why the sentence is not a translation key
 *
 * The reason arrives as prose FROM THE HUB, which is the only thing that knows
 * how much media landed against how much the catalog row promised. It already
 * names the figures. A viewer that re-worded it would be a second authority
 * for one measurement (D62), and one that padded it with a key of its own
 * would say the same thing twice. The heading above it — the part the viewer
 * DOES own — is translated, in both locales.
 *
 * Presentational: the caller owns the notice; there is no action to own.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { TriangleAlert } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { useTimelineScale } from './TimelineScaleProvider.js'
import type { ClipIncompleteNotice } from '../../../clips/clip-incomplete-notice.js'
import type { ClipIncompleteCode } from '../../../recording/recording-messages.js'

export interface TimelineClipIncompleteNoticeProps {
  /** Resolved by `resolveClipIncompleteNotice` against the clip on the stage.
   *  `null` (the ordinary case) renders nothing, not even the band. */
  readonly notice: ClipIncompleteNotice
}

/**
 * The heading, per kind. Two, because a camera that granted the session and
 * sent NOTHING is a different complaint from one that sent some of the clip —
 * and the hub's own sentence for the empty case already says so. Folding them
 * would put "the rest of the clip is still on the camera" over a clip that has
 * no rest.
 */
const TITLE_KEY: Readonly<Record<ClipIncompleteCode, string>> = {
  'stream-short': 'v2.timeline.clipShortTitle',
  'stream-empty': 'v2.timeline.clipEmptyTitle',
}

export function TimelineClipIncompleteNotice({
  notice,
}: TimelineClipIncompleteNoticeProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ui = useTimelineScale()

  // A clip that arrived whole draws NOTHING — the same discipline as the fault
  // band above it. A notice that shows on the common case teaches the operator
  // to ignore it on the day it matters.
  if (notice === null) return null

  const title = t(TITLE_KEY[notice.kind])

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, borderBottomColor: colors.border },
      ]}
      accessibilityRole="alert"
      // The heading and the hub's sentence, as ONE label: a screen reader that
      // announced only the title would say a clip is short and never say by
      // how much, which is the entire content of the report.
      accessibilityLabel={`${title} — ${notice.reason}`}
    >
      <View
        style={[
          styles.row,
          { paddingHorizontal: ui.space.md, paddingVertical: ui.space.sm, gap: ui.space.sm },
        ]}
      >
        <TriangleAlert size={ui.icon.sm} color={colors.danger} />
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.foreground, fontSize: ui.font.xs }]}>
            {title}
          </Text>
          {/* Up to three lines, and no `numberOfLines={1}`: the hub's sentence
              is a whole measurement ("4.3 s of 45.0 s arrived, 40.7 s short")
              and truncating it to one line on a phone would cut off the
              figures, which are the only part an operator can act on. Nothing
              competes for the width here — there is no chip. */}
          <Text
            numberOfLines={3}
            style={[styles.reason, { color: colors.foregroundMuted, fontSize: ui.font.xs }]}
          >
            {notice.reason}
          </Text>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    // The SAME hairline the fault band and the playback bar close with, so the
    // stacked chrome reads as one unit rather than as unrelated bars.
    borderBottomWidth: 1,
    // Below the fault band (10) and the playback bar's dropdown (15), above
    // the body. The rank only matters against what OVERLAPS: these notices are
    // laid-out siblings in one column and never cover each other, so it shares
    // the history notice's 9 rather than inventing a rung between them.
    zIndex: 9,
    elevation: 9,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  text: {
    flex: 1,
  },
  title: {
    fontWeight: '700',
  },
  reason: {
    fontWeight: '500',
  },
})
