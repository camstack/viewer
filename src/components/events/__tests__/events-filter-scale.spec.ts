/**
 * The Events filters draw at the scale of the rest of the Library header.
 *
 * Two drifts, both reported by the operator as "out of scale": the Classes
 * menu's Faces/Plates rows had their own smaller row and checkbox above the
 * kind tree's, and the search field sat on an 8 pt gutter with 15 pt type
 * under a filter row and a grid on the 16 pt `SCREEN_GUTTER`.
 *
 * Source text, because the claim is about which row and which gutter these
 * surfaces BIND.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

describe('Events filter scale', () => {
  it('Faces/Plates are the kind tree\'s own CheckRow, not a local look-alike', () => {
    const bar = read('src/components/events/EventsFilterBar.tsx')
    expect(bar).toContain('<CheckRow')
    expect(bar).not.toContain('styles.checkbox')
    expect(bar).not.toContain('styles.optionRow')
  })

  it('the search field sits on the Library gutter with a token type size', () => {
    const search = read('src/components/events/track/SemanticSearchBar.tsx')
    expect(search).toContain('marginHorizontal: SCREEN_GUTTER')
    expect(search).not.toMatch(/fontSize:\s*\d/)
  })
})
