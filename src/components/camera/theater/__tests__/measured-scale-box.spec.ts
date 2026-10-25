/**
 * The wide rail's scale wrapper must be BOUNDED by the rail.
 *
 * Measured on the hosted PWA (Chrome, 1512x722, `theater-shape-wide`): the
 * wrapper `MeasuredTimelineScale` renders around the toolbar AND the timeline
 * body was a bare `<View>` — content-sized in a column. The body measures its
 * own height as the timeline's viewport, the scroller lays out
 * `max(viewport, day span) + trailing room` of content from that viewport,
 * and the unbounded wrapper grew to fit it: the next layout measured a taller
 * viewport, which made taller content, which made a taller wrapper. Sampled
 * scrollHeight: 66 716 → 266 864 → 2 134 912 → … → 33 554 432 px (Chrome's
 * layout ceiling) within ~5 s, scrollTop pinned at 0. Rows past the ceiling
 * clamp onto it, so the rail showed hour rows such as 21:15…21:00 / 04:04 at
 * 15:51-16:13 local, and the runaway layout starved the page's main thread.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { measuredScaleBoxStyle } from '../measured-scale-width.js'

describe('measuredScaleBoxStyle', () => {
  it('a wrapper that holds the timeline body fills its parent and may shrink below its content', () => {
    expect(measuredScaleBoxStyle(true)).toEqual({ flex: 1, minHeight: 0 })
  })

  it('a wrapper around the toolbar alone stays content-sized (no flex in an auto-height parent)', () => {
    expect(measuredScaleBoxStyle(false)).toBeUndefined()
  })
})

describe('the wide rail bounds the timeline body', () => {
  const src = readFileSync(
    join(process.cwd(), 'src', 'components', 'camera', 'theater', 'TheaterTimeline.tsx'),
    'utf8',
  )

  it('the MeasuredTimelineScale that wraps bodyEl in the wide rail is told to fill', () => {
    const wide = src.slice(src.indexOf("shape === 'wide' ? ("))
    const mount = wide.slice(wide.indexOf('<MeasuredTimelineScale'), wide.indexOf('</MeasuredTimelineScale>'))
    expect(mount).toContain('{bodyEl}')
    expect(mount).toMatch(/<MeasuredTimelineScale[^>]*\bfill\b/)
  })

  it('the wrapper applies the box style', () => {
    const wrapper = readFileSync(
      join(process.cwd(), 'src', 'components', 'camera', 'theater', 'MeasuredTimelineScale.tsx'),
      'utf8',
    )
    expect(wrapper).toMatch(/style=\{measuredScaleBoxStyle\(fill/)
  })
})
