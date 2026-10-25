/**
 * TrackDetailModal — the sheet presentation of {@link TrackDetailView}.
 * Renders only when `track` is non-null. The reel and the events-page track list
 * both wrap the SAME body so the two surfaces never fork their fetch/rendering.
 */
import React, { memo } from 'react'
import { View, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../../theme/theme-provider.js'
import { ConfirmProvider } from '../../ui/confirm.js'
import { SheetModal } from '../../ui/SheetModal.js'
import { TrackDetailView } from './TrackDetailView.js'
import type { TrackSummary } from '../../../data/track-events.js'
import type { TrackDetailNavigation } from '../../../data/track-navigation.js'

export interface TrackDetailModalProps {
  readonly track: TrackSummary | null
  readonly onSeek?: (epochMs: number) => void
  readonly onClose: () => void
  /** Prev/next over the caller's collection — forwarded to the shared body. */
  readonly navigation?: TrackDetailNavigation
  /** Why this was opened — see `TrackDetailViewProps.openIntent`. */
  readonly openIntent?: 'assign-face'
}

export const TrackDetailModal = memo(function TrackDetailModal({
  track, onSeek, onClose, navigation, openIntent,
}: TrackDetailModalProps) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()

  // The detail opens in the ONE sheet frame (operator, 2026-10-21): a
  // full-height sheet on a phone, a centred dialog on the web — the same frame
  // the face and plate details use. `SheetModal` re-roots gesture handling in
  // its window, which the ZoomableImage's pinch needs on the New Architecture.
  return (
    <SheetModal
      visible={track !== null}
      onClose={onClose}
      testID="track-detail-sheet"
      sheetStyle={[styles.sheet, { backgroundColor: colors.background, paddingTop: insets.top }]}
    >
      {/* The dialogs a track opens (the debug-note prompt, a confirm) are
          RN <Modal>s too. Served by the ROOT provider they are presented
          from the root view controller — which is already presenting THIS
          modal, so UIKit refuses the second presentation: the note prompt
          never showed and the app hung there (2026-09-06). A provider in
          this window presents them from the presented controller. */}
      <ConfirmProvider>
        <View style={styles.body}>
          {track !== null ? (
            <TrackDetailView
              track={track}
              onSeek={onSeek}
              onClose={onClose}
              navigation={navigation}
              openIntent={openIntent}
            />
          ) : null}
        </View>
      </ConfirmProvider>
    </SheetModal>
  )
})

const styles = StyleSheet.create({
  // Full height on a phone; the web dialog frame caps it at 90% of the window.
  sheet: { height: '100%' },
  body: { flex: 1 },
})
