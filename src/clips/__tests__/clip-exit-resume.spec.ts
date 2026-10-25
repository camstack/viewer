/**
 * Leaving clips mode lands where the clip was.
 *
 * Two things are pinned here and they are different: the ARITHMETIC (a clip's
 * position is file-relative, the recorded axis is wall-clock) and the ORDER of
 * the two actions the screen takes, which is load-bearing and silently
 * invertible.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clipExitResumeMs } from '../clip-exit-resume.js'

const CLIP_START = 1_790_000_000_000

describe('clipExitResumeMs', () => {
  it('adds the file-relative position to the clip start', () => {
    expect(
      clipExitResumeMs({ heldClipId: 'c1', clipStartMs: CLIP_START, clipPositionMs: 12_000 }),
    ).toBe(CLIP_START + 12_000)
  })

  it('answers null when no clip is on the frame', () => {
    // `activeEpoch` is the RECORDED playhead when no clip is held. Adding an
    // offset to it would "resume" at a point that belongs to nothing, moving
    // the playhead away from where the operator left it.
    expect(
      clipExitResumeMs({ heldClipId: null, clipStartMs: CLIP_START, clipPositionMs: 12_000 }),
    ).toBeNull()
  })

  it('answers null before the clip has reported a position', () => {
    expect(
      clipExitResumeMs({ heldClipId: 'c1', clipStartMs: CLIP_START, clipPositionMs: null }),
    ).toBeNull()
  })

  it('answers null when the clip start is not known', () => {
    expect(clipExitResumeMs({ heldClipId: 'c1', clipStartMs: null, clipPositionMs: 0 })).toBeNull()
  })

  it('resumes at the clip START when it never advanced', () => {
    // 0 is a POSITION, not an absence — the operator opened a clip and left it
    // immediately, and the honest landing is its first frame.
    expect(clipExitResumeMs({ heldClipId: 'c1', clipStartMs: CLIP_START, clipPositionMs: 0 })).toBe(
      CLIP_START,
    )
  })
})

describe('the screen releases the clip BEFORE it seeks', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'screens', 'CameraDetailScreen.tsx'), 'utf8')

  it('closes first, seeks second', () => {
    // While a clip holds the frame the scrub family is routed to the CLIP
    // feeder on the file's own axis. Seeking first would drive the clip, not
    // the recording — the operator would watch the clip jump instead of
    // leaving it. The order is the fix; reversing it compiles and looks right.
    const body = src.slice(src.indexOf('const onLeaveClipsMode'))
    const close = body.indexOf('closeClipStage()')
    const seek = body.indexOf('wallPlayback.onSeek(resumeAtMs')
    expect(close).toBeGreaterThan(-1)
    expect(seek).toBeGreaterThan(-1)
    expect(close).toBeLessThan(seek)
  })

  it('does not seek at all when there is nothing to resume to', () => {
    const body = src.slice(src.indexOf('const onLeaveClipsMode'))
    expect(body.slice(0, body.indexOf('wallPlayback.onSeek'))).toContain(
      'if (resumeAtMs === null) return',
    )
  })
})
