/**
 * FaceTrackDetail — the track a face came from, opened over the People page.
 *
 * The face detail's "Open event" names a track by `(deviceId, trackId)`; the
 * track detail needs the whole row. `useTrackById` is the resolver the events
 * page's deep link already uses, and `TrackDetailModal` the one sheet every
 * surface opens a track in — so this is wiring, not a second detail. Closing it
 * returns the operator to the People page they came from, which a jump to the
 * Events section would not.
 *
 * A track the hub cannot answer for (pruned by retention, an older hub) is
 * said, once, instead of an open that never arrives.
 */
import React, { memo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useTrackById } from '../../data/use-track-by-id.js'
import { TrackDetailModal } from '../events/track/TrackDetailModal.js'
import { useNotice } from '../ui/confirm.js'

/** Which track to open; `null` ⇒ closed. */
export interface FaceTrackTarget {
  readonly deviceId: number
  readonly trackId: string
  readonly cameraName: string
}

export interface FaceTrackDetailProps {
  readonly target: FaceTrackTarget | null
  readonly onClose: () => void
}

export const FaceTrackDetail = memo(function FaceTrackDetail({ target, onClose }: FaceTrackDetailProps) {
  const { t } = useTranslation()
  const notice = useNotice()
  const { track, loading } = useTrackById(
    target?.deviceId ?? null,
    target?.trackId ?? null,
    target?.cameraName ?? '',
  )

  const missing = target !== null && !loading && track === null
  useEffect(() => {
    if (!missing) return
    onClose()
    void notice({ title: t('v2.faceReview.openEvent'), message: t('v2.faceReview.trackMissing') })
  }, [missing, onClose, notice, t])

  return <TrackDetailModal track={target !== null ? track : null} onClose={onClose} />
})
