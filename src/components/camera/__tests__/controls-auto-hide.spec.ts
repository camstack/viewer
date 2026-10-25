import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONTROLS_AUTO_HIDE_MS } from '../controls-auto-hide.js'

const GROUP = join(process.cwd(), 'src', 'components', 'camera', 'OverlayDiscGroup.tsx')

describe('on-video controls auto-hide', () => {
  it('stay visible 10 seconds', () => {
    expect(CONTROLS_AUTO_HIDE_MS).toBe(10_000)
  })

  it('the group arms AND re-arms its timer from that one constant', () => {
    const src = readFileSync(GROUP, 'utf8')
    const armed = src.match(/setTimeout\(\s*onRequestHide,\s*([A-Z_]+)\s*\)/g) ?? []
    // Once on show, once after a press.
    expect(armed).toHaveLength(2)
    for (const call of armed) expect(call).toContain('CONTROLS_AUTO_HIDE_MS')
    // No second literal hiding in the file.
    expect(src).not.toMatch(/setTimeout\([^)]*\b\d{3,}\b/)
  })
})
