/**
 * GalleryFaceAssign — the "?" chip's destination: the face → person assignment
 * sheet, opened straight over the gallery.
 *
 * The chip used to open the track DETAIL with an "assign" intent and let the
 * detail raise the sheet over itself; the detail painted underneath and closing
 * the sheet had to tear it down again. The operator asked for the associator
 * and nothing else, so the sheet is mounted here on its own: it reads the face
 * of the tapped track, shows once it has it, and closing it leaves the gallery
 * exactly as it was.
 */
import React, { memo, useEffect } from 'react'

import { useTrackFace } from '../../../data/use-face-gallery.js'
import type { EventsTrackRow } from '../../../../shared/events/events-track-row.js'
import { FaceAssignSheet } from '../track/FaceAssignSheet.js'

export interface GalleryFaceAssignProps {
  /** The track whose "?" was pressed; null = nothing to assign. */
  readonly row: EventsTrackRow | null
  readonly onClose: () => void
}

export const GalleryFaceAssign = memo(function GalleryFaceAssign({ row, onClose }: GalleryFaceAssignProps) {
  const { data: face, isSuccess } = useTrackFace(row?.deviceId ?? 0, row?.trackId ?? '', row !== null)
  // The hub knows no face for this track (it was cleaned up since the chip was
  // drawn): there is nothing to assign, so do not leave a request pending.
  const gone = row !== null && isSuccess && face === null
  useEffect(() => {
    if (gone) onClose()
  }, [gone, onClose])
  return <FaceAssignSheet face={row === null ? null : (face ?? null)} onClose={onClose} />
})
