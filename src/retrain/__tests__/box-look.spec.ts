import { describe, expect, it } from 'vitest'
import { THEME } from '../../theme/tokens.js'
import { BOX_DIFF_KINDS } from '../live-review.js'
import { boxLook, SUMMARY_SYMBOL } from '../box-look.js'

describe('boxLook', () => {
  it('maps every diff kind to a real theme token', () => {
    for (const kind of BOX_DIFF_KINDS) {
      const look = boxLook(kind)
      expect(THEME.dark[look.stroke], kind).toBeTypeOf('string')
      expect(THEME.dark[`${look.tone}Fill`], kind).toBeTypeOf('string')
      expect(SUMMARY_SYMBOL[kind], kind).toBeTruthy()
    }
  })

  it('stroke colour is the diff: added success, removed danger, reclassified warning, adjusted info', () => {
    expect(boxLook('added').stroke).toBe('success')
    expect(boxLook('removed').stroke).toBe('danger')
    expect(boxLook('reclassified').stroke).toBe('warning')
    expect(boxLook('adjusted').stroke).toBe('info')
    expect(boxLook('unchanged').stroke).toBe('foregroundMuted')
    expect(boxLook('draft').stroke).toBe('primary')
  })

  it('a model error is NOT a removed box: same colour family, outline and dashed vs filled and dotted', () => {
    const removed = boxLook('removed')
    const modelError = boxLook('model-error')
    expect(modelError.stroke).toBe(removed.stroke)
    expect(modelError.badgeLook).toBe('outline')
    expect(removed.badgeLook).toBe('fill')
    expect(modelError.strokeStyle).toBe('dashed')
    expect(removed.strokeStyle).toBe('dotted')
  })
})
