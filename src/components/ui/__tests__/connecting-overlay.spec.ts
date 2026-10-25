/**
 * The connection state is a floating glass overlay (operator, 2026-10-22), not
 * an in-flow pill that pushes the content under the bars.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, '..', 'ConnectingIndicator.tsx'), 'utf8')

describe('ConnectingIndicator overlay', () => {
  it('is absolute, glass, safe-area aware and lets touches through', () => {
    expect(src).toContain("position: 'absolute'")
    expect(src).toContain('<GlassSurface')
    expect(src).toContain('insets.top')
    expect(src).toContain('pointerEvents="box-none"')
  })
  it('fades and slides, and honours reduce-motion', () => {
    expect(src).toContain('translateY')
    expect(src).toContain('timingTo(')
    expect(src).toContain('useReducedMotion')
  })
  it('has no in-flow margins left over from the banner', () => {
    expect(src).not.toContain('marginVertical')
    expect(src).not.toContain('alignSelf')
  })
})
