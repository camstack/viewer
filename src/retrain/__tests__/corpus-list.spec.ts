import { describe, expect, it } from 'vitest'
import { chunkRetrainRows, frameDateLabel, sortNewestFirst } from '../corpus-list.js'

const words = { today: (t: string) => `Today ${t}`, yesterday: (t: string) => `Yesterday ${t}` }
const at = (y: number, mo: number, d: number, h = 14, mi = 5): number =>
  new Date(y, mo - 1, d, h, mi).getTime()

describe('sortNewestFirst', () => {
  it('orders by capture time descending, copy time as the fallback, stable on ties', () => {
    const out = sortNewestFirst([
      { id: 'a', copiedAt: 100 },
      { id: 'b', copiedAt: 1, capturedAt: 500 },
      { id: 'c', copiedAt: 300 },
      { id: 'd', copiedAt: 100 },
    ])
    expect(out.map((f) => f.id)).toEqual(['b', 'c', 'a', 'd'])
  })
  it('does not mutate its input', () => {
    const input = [{ copiedAt: 1 }, { copiedAt: 2 }]
    sortNewestFirst(input)
    expect(input[0]?.copiedAt).toBe(1)
  })
})

describe('chunkRetrainRows', () => {
  it('groups frames into rows of the grid width without dropping the tail', () => {
    expect(chunkRetrainRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})

describe('frameDateLabel', () => {
  const now = at(2026, 10, 14, 19, 0)
  it('says today and yesterday', () => {
    expect(frameDateLabel(at(2026, 10, 14, 9, 30), now, 'en-GB', words)).toBe('Today 09:30')
    expect(frameDateLabel(at(2026, 10, 13, 23, 59), now, 'en-GB', words)).toBe('Yesterday 23:59')
  })
  it('gives a short date otherwise, with the year only when it differs', () => {
    expect(frameDateLabel(at(2026, 10, 2, 8, 0), now, 'en-GB', words)).toBe('2 Oct, 08:00')
    expect(frameDateLabel(at(2025, 12, 31, 8, 0), now, 'en-GB', words)).toContain('2025')
  })
  it('follows the locale', () => {
    expect(frameDateLabel(at(2026, 10, 2, 8, 0), now, 'it', words)).toMatch(/2 ott/)
  })
})
