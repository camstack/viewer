/**
 * presented-clock — the recorded epoch of the frame the browser PRESENTED.
 *
 * The hub's `position` message names the SEND cursor: the instant of the last
 * frame it pushed, which is ahead of the picture by the network and the jitter
 * buffer. To name the frame on screen the message carries the RTP timestamp of
 * that same push (`rtpTs`, plus `rtpHz` and the play `rate`); every presented
 * frame reports its own RTP timestamp through `requestVideoFrameCallback`
 * metadata, so the presented epoch is the anchor epoch plus the media time
 * elapsed between the two timestamps, scaled by the play rate.
 *
 * Pure and immutable. No `rtpTs` on the message (a hub that does not send it),
 * or no `rtpTimestamp` in the frame metadata (an engine that does not expose
 * it), means no anchor and no presented epoch: the caller keeps the cursor.
 */

/** The RTP video clock when the message does not state one. */
export const DEFAULT_RTP_HZ = 90_000

const RTP_MODULO = 0x1_0000_0000

export interface PresentedAnchor {
  /** RTP timestamp (uint32) of the newest frame pushed at `epochMs`. */
  readonly rtpTs: number
  readonly epochMs: number
  readonly rtpHz: number
  /** Recorded ms per media ms (the play rate the push was made at). */
  readonly rate: number
}

function isUint32(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < RTP_MODULO
}

/** The anchor a `position` message carries; null when it carries no RTP stamp. */
export function anchorFromPosition(msg: {
  readonly epochMs: number
  readonly rtpTs?: unknown
  readonly rtpHz?: unknown
  readonly rate?: unknown
}): PresentedAnchor | null {
  if (!isUint32(msg.rtpTs)) return null
  const rtpHz = typeof msg.rtpHz === 'number' && msg.rtpHz > 0 ? msg.rtpHz : DEFAULT_RTP_HZ
  const rate = typeof msg.rate === 'number' && msg.rate > 0 ? msg.rate : 1
  return { rtpTs: msg.rtpTs, epochMs: msg.epochMs, rtpHz, rate }
}

/** Signed distance from `from` to `to` on the wrapping uint32 RTP clock. */
export function rtpDelta(from: number, to: number): number {
  const d = (to - from + RTP_MODULO) % RTP_MODULO
  return d >= RTP_MODULO / 2 ? d - RTP_MODULO : d
}

/** The recorded epoch of a presented frame; null without anchor or RTP stamp. */
export function presentedEpoch(anchor: PresentedAnchor | null, rtpTimestamp: unknown): number | null {
  if (anchor === null || !isUint32(rtpTimestamp)) return null
  return anchor.epochMs + (rtpDelta(anchor.rtpTs, rtpTimestamp) / anchor.rtpHz) * 1000 * anchor.rate
}
