import { describe, expect, it } from 'vitest'

import { clipStartOnFrame } from '../clip-on-frame.js'
import type { Clip } from '../clip-model.js'
import type { ClipStage } from '../clip-stage.js'

const clip = (clipId: string, startMs: number): Clip =>
  ({ clipId, deviceId: 3628, startMs, endMs: startMs + 20_000 }) as unknown as Clip

const CLIPS = [clip('a', 1_000), clip('b', 2_000)]

describe('clipStartOnFrame', () => {
  it('names the held clip’s own start', () => {
    expect(clipStartOnFrame(CLIPS, { kind: 'clip', clipId: 'b' } as unknown as ClipStage)).toBe(2_000)
  })

  it('is null when the session holds the frame — the chrome keeps its own clock', () => {
    expect(clipStartOnFrame(CLIPS, { kind: 'session' })).toBeNull()
  })

  it('is null for a clip the caller does not hold — an unknown time is not guessed', () => {
    // The list is refetched constantly; a held id that has aged out must not
    // become somebody else's timestamp.
    expect(clipStartOnFrame(CLIPS, { kind: 'clip', clipId: 'gone' } as unknown as ClipStage)).toBeNull()
  })
})
