/**
 * cluster-members — the pure rules of a cluster card's strip of members.
 *
 * WHERE a tap on a member seeks ({@link memberSeekMs}) lives here and nowhere
 * else. Playback never lights or scrolls a member.
 */
import { eventMomentSeekMs } from '../../../recording/playback-status.js'
import type { ObjectEvent } from './event-cluster.js'

/** A tap on a member lands this far BEFORE its event starts, so the operator
 *  sees the subject arrive rather than a subject already in the frame. */
export const MEMBER_SEEK_LEAD_MS = 2_000

/** The epoch a tap on `event` seeks the stream to. */
export function memberSeekMs(event: ObjectEvent): number {
  return eventMomentSeekMs(event.timestamp - MEMBER_SEEK_LEAD_MS)
}
