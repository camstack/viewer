/**
 * The caption a gallery-panel thumbnail carries: the RICHEST label the event has.
 *
 * Precedence is the shared `trackTitle` rule (identity / plate text in
 * `subLabel`, verbatim, then the translated sub-class `label`, then the
 * translated class), with ONE addition the track title has no use for: an audio
 * event (class `audio`) names what was HEARD — the translated audio label — in
 * place of the bare word "Audio". No new vocabulary: every translation goes
 * through the caller's `EventKindResolver`.
 */
import { trackTitle } from '../../../data/track-events.js'
import type { EventKindResolver } from '../../../data/use-event-kind-resolver.js'
import type { ObjectEvent } from './event-cluster.js'

export type ThumbCaptionResolver = Pick<EventKindResolver, 'resolveLabel' | 'resolveAudioLabel'>

export function thumbCaptionLabel(
  event: Pick<ObjectEvent, 'className' | 'label' | 'subLabel' | 'audioLabels'>,
  resolver: ThumbCaptionResolver,
): string {
  const hasEnrichment = event.subLabel !== undefined || event.label !== undefined
  const heard = event.audioLabels?.find((l) => l.length > 0)
  if (!hasEnrichment && heard !== undefined && event.className.toLowerCase() === 'audio') {
    return resolver.resolveAudioLabel(heard)
  }
  return trackTitle(
    {
      producingDeviceName: undefined,
      subLabel: nonEmpty(event.subLabel),
      label: nonEmpty(event.label),
      className: event.className,
    },
    resolver.resolveLabel,
  )
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined
}
