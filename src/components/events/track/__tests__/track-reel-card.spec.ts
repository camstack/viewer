import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, '..', 'TrackReel.tsx'), 'utf8')

describe('ReelCard wiring', () => {
  it('shows the corner time chip like the events gallery', () => {
    expect(SRC).toContain('showTime')
    expect(SRC).toMatch(/showTime\s*\/>/)
  })

  it('does not render a footer time row under the hero', () => {
    expect(SRC).not.toContain('dayRelativeLabel')
    expect(SRC).not.toContain('styles.footer')
    expect(SRC).not.toContain('styles.time')
  })

  it('uses formatEventTime via chips.time for accessibility', () => {
    expect(SRC).toContain('chips.time')
    expect(SRC).toContain('tileAccessibilityLabel')
  })
})
