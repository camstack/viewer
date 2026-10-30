/**
 * EventActionMenu — "keep this event": the ONE menu behind a cluster pill's
 * long press and the track detail's Download button.
 *
 * Three actions, no confirmation step:
 *
 *  - Download clip — the event's span plus 3 s each side, queued through the
 *    shared export path (`useRunExport`); the Activity button acknowledges it;
 *  - Download snapshot — the camera's native full frame;
 *  - Download keyframe — the pipeline's clean key frame at native resolution.
 *
 * A still the event does not have is drawn dimmed, never dropped. The menu
 * dims the page behind it; the surface that opened it may pass `highlight`, a
 * copy of what was pressed drawn above the dim.
 *
 * Mounted only while open: the media listing and the export hooks it holds cost
 * nothing on a closed surface.
 */
import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useEventStills } from '../../data/use-event-stills.js'
import { useShareTrackMedia } from '../../data/use-share-track-media.js'
import { hapticAction } from '../../lib/haptics.js'
import { Camera, Clapperboard, Image } from '../../lib/icons.js'
import {
  eventStillFilename,
  planEventClip,
  type EventDownloadTarget,
  type EventStillKind,
} from '../../recording/event-download.js'
import { useRunExport } from '../../recording/use-run-export.js'
import { AnchoredMenu } from '../ui/AnchoredMenu.js'
import { useNotice } from '../ui/confirm.js'
import type { AnchorRect } from '../ui/dropdown-placement.js'
import { MenuRow } from '../ui/MenuRow.js'

export const EVENT_ACTION_MENU_TEST_ID = 'event-action-menu'
export const EVENT_ACTION_CLIP_TEST_ID = 'event-action-clip'
export const EVENT_ACTION_SNAPSHOT_TEST_ID = 'event-action-snapshot'
export const EVENT_ACTION_KEYFRAME_TEST_ID = 'event-action-keyframe'

const MENU_WIDTH = 230
/** Three rows, for placing the menu before it is measured. */
const MENU_HEIGHT = 3 * 48 + 8

export interface EventActionMenuProps {
  readonly visible: boolean
  readonly target: EventDownloadTarget
  readonly anchor: AnchorRect | null
  readonly onClose: () => void
  readonly highlight?: React.ReactNode
}

export function EventActionMenu(props: EventActionMenuProps): React.JSX.Element | null {
  if (!props.visible) return null
  return <OpenEventActionMenu {...props} />
}

function OpenEventActionMenu({ target, anchor, onClose, highlight }: EventActionMenuProps): React.JSX.Element {
  const { t } = useTranslation()
  const notice = useNotice()
  const { run } = useRunExport(target.deviceId, target.cameraName, { announceStart: false })
  const found = useEventStills(target)
  const shared = useShareTrackMedia(target.deviceId, target.trackId)
  const stills = found.status === 'ready' ? found.stills : null

  // Felt once, as the menu appears.
  useEffect(() => {
    hapticAction()
  }, [])

  // A still is handed over when its bytes land; the menu stays until then so
  // the request is not abandoned with it.
  useEffect(() => {
    if (shared.result === 'idle') return
    if (shared.result === 'failed') notice({ title: t('v2.eventMenu.title'), message: t('v2.eventMenu.failed') })
    onClose()
  }, [shared.result, notice, onClose, t])

  const onClip = useCallback((): void => {
    onClose()
    void run(planEventClip(target, Date.now()))
  }, [onClose, run, target])

  const onStill = useCallback(
    (kind: EventStillKind): void => {
      const file = stills === null ? null : kind === 'snapshot' ? stills.snapshot : stills.keyframe
      if (file === null || shared.busy) return
      shared.share(file, eventStillFilename(target, kind))
    },
    [shared, stills, target],
  )

  return (
    <AnchoredMenu
      visible
      onRequestClose={onClose}
      anchor={anchor}
      width={MENU_WIDTH}
      estimatedHeight={MENU_HEIGHT}
      scrim
      highlight={highlight}
    >
      <MenuRow
        testID={EVENT_ACTION_CLIP_TEST_ID}
        icon={Clapperboard}
        label={t('v2.eventMenu.clip')}
        onPress={onClip}
      />
      <MenuRow
        testID={EVENT_ACTION_SNAPSHOT_TEST_ID}
        icon={Camera}
        label={t('v2.eventMenu.snapshot')}
        disabled={stills === null || stills.snapshot === null}
        onPress={() => onStill('snapshot')}
      />
      <MenuRow
        testID={EVENT_ACTION_KEYFRAME_TEST_ID}
        icon={Image}
        label={t('v2.eventMenu.keyframe')}
        disabled={stills === null || stills.keyframe === null}
        onPress={() => onStill('keyframe')}
      />
    </AnchoredMenu>
  )
}
