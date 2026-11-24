import { describe, expect, it } from 'vitest'

import { Layers } from '../../lib/icons.js'
import { appIconFor } from '../app-icons.js'

describe('an icon is data: the hub sends a name, the shell maps it', () => {
  it('maps the names the hub sends', () => {
    expect(appIconFor('bell')).not.toBe(Layers)
    expect(appIconFor('Line-Chart')).toBe(appIconFor('chart-line'))
  })
  it('a name it does not know is the neutral glyph, never a crash', () => {
    expect(appIconFor('definitely-not-an-icon')).toBe(Layers)
    expect(appIconFor('')).toBe(Layers)
  })
})
