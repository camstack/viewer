import { describe, it, expect } from 'vitest'
import { lanesActiveAt } from '../timeline-lanes-layout.js'

const DATA = {
  recording: [{ startMs: 100, endMs: 200 }],
  motion: [{ startMs: 150, endMs: 160, intensity: 0.5 }, { startMs: 300, endMs: 310, intensity: 0 }],
  audio: [],
}

describe('lanesActiveAt — a dot only where the cursor meets a segment', () => {
  it('recording only', () => expect(lanesActiveAt(DATA, 120)).toEqual(['recording']))
  it('recording and motion', () => expect(lanesActiveAt(DATA, 155)).toEqual(['recording', 'motion']))
  it('an empty lane or a zero-intensity bucket draws nothing', () => {
    expect(lanesActiveAt(DATA, 305)).toEqual([])
    expect(lanesActiveAt(DATA, 500)).toEqual([])
  })
})
