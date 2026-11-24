import { describe, expect, it } from 'vitest'

import { backFromAdhocGrid, parseAdhocOrigin } from '../adhoc-back.js'

function router() {
  const calls: string[] = []
  return { calls, dismissTo: (href: string) => void calls.push(href) }
}

describe('/grid/adhoc back (#700)', () => {
  it('a link that names its camera backs out to THAT camera', () => {
    const r = router()
    backFromAdhocGrid(r, 7)
    expect(r.calls).toEqual(['/camera/7'])
  })

  it('a link with no origin backs out to the Cameras tab — never a dead end', () => {
    const r = router()
    backFromAdhocGrid(r, null)
    expect(r.calls).toEqual(['/cameras'])
  })

  it('parses ?from= tolerantly', () => {
    expect(parseAdhocOrigin('12')).toBe(12)
    expect(parseAdhocOrigin(['3', '4'])).toBe(3)
    expect(parseAdhocOrigin(undefined)).toBeNull()
    expect(parseAdhocOrigin('x')).toBeNull()
    expect(parseAdhocOrigin('-2')).toBeNull()
    expect(parseAdhocOrigin('1.5')).toBeNull()
  })
})
