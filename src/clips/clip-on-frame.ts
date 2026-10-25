/**
 * The instant the CHROME should name while a clip holds the frame.
 *
 * ## The lie this removes
 *
 * The header, the playhead and every label around the picture read
 * `activeEpoch` — the playback machine's position. A clip deliberately does
 * not move that machine (it is a FILE; no epoch addresses a position inside
 * it), so while a clip plays the chrome goes on naming wherever the session
 * was left.
 *
 * On 2026-09-21 that read as the list being wrong: a card labelled ~16:00
 * opened and the frame said ~21:00 — the last movement, which is where the
 * timeline had been. Five taps were measured that day and the card, the clip
 * and the camera's own file name agreed to the second every time. The list was
 * never the thing that lied.
 *
 * This is the clip's START, not a position inside it: the file's own progress
 * belongs to the transport, and inventing a moving epoch here would put a
 * second authority on the playhead — the defect one file over (`clip-stage.ts`).
 */
import type { Clip } from './clip-model.js'
import type { ClipStage } from './clip-stage.js'

/**
 * `null` when no clip holds the frame, or when the held clip is not in the
 * list the caller has — an unknown clip's time is not guessed.
 */
export function clipStartOnFrame(clips: readonly Clip[], stage: ClipStage): number | null {
  if (stage.kind !== 'clip') return null
  const held = clips.find((clip) => clip.clipId === stage.clipId)
  return held?.startMs ?? null
}
