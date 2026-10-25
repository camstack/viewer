/**
 * The viewer draws any catalog key from generated node data. A server catalog
 * bump that adds a key fails HERE until `npm run gen:icon-nodes` is rerun.
 */
import { describe, expect, it } from 'vitest'
import { ICON_KEYS, ICON_VIEWER_MODULES } from '@camstack/types/client'

import { ICON_NODES } from '../icon-nodes.generated.js'
import { iconNodeFor } from '../icon-node-for.js'

describe('icon node data', () => {
  it('has drawing data for every catalog key, and for nothing else', () => {
    const missing = ICON_KEYS.filter((key) => (ICON_NODES[key]?.length ?? 0) === 0)
    expect(missing, 'run npm run gen:icon-nodes').toEqual([])
    expect(Object.keys(ICON_NODES).sort()).toEqual([...ICON_KEYS].sort())
  })

  it('draws keys whose viewer module is named differently', () => {
    for (const key of Object.keys(ICON_VIEWER_MODULES)) {
      expect(iconNodeFor(key, ICON_NODES), key).toBeDefined()
    }
  })

  it('resolves an old spelling and refuses an unknown value', () => {
    expect(iconNodeFor('gauge2', ICON_NODES)).toBe(ICON_NODES.gauge)
    expect(iconNodeFor('helicopter-pad', ICON_NODES)).toBeUndefined()
    expect(iconNodeFor(null, ICON_NODES)).toBeUndefined()
  })
})
