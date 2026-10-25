import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { GLASS_PRESS, glassPressTarget } from '../glass-press.js'
import { GLASS } from '../../../theme/tokens.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (rel: string): string => readFileSync(path.join(SRC, rel), 'utf8')

describe('the glass press animation config', () => {
  it('shrinks to ~0.92 with a slight opacity dip, and rests at 1', () => {
    expect(GLASS_PRESS.pressed.scale).toBe(0.92)
    expect(GLASS_PRESS.pressed.opacity).toBeLessThan(1)
    expect(GLASS_PRESS.pressed.opacity).toBeGreaterThan(0.7)
    expect(glassPressTarget(true)).toEqual(GLASS_PRESS.pressed)
    expect(glassPressTarget(false)).toEqual(GLASS_PRESS.rest)
  })

  it('a disabled control never leaves rest', () => {
    expect(glassPressTarget(true, true)).toEqual(GLASS_PRESS.rest)
  })

  it('springs through the motion presets and gives native glass its own interactive highlight', () => {
    const src = read('components/ui/GlassButton.tsx')
    expect(src).toContain('springTo(')
    expect(src).not.toContain('withSpring')
    expect(src).toMatch(/GlassSurface[\s\S]*?interactive=\{!disabled\}/)
  })
})

describe('every glass control goes through the one pressable', () => {
  it('the player toolbar is three GlassSurface capsules of GlassPressables', () => {
    const src = read('components/camera/theater/TimelineToolbarInline.tsx')
    expect(src).toContain('TOOLBAR_CONTROL_SIZE')
    expect(src).toContain('timeline-nav-capsule')
    expect(src).toContain('timeline-date-pill')
    expect(src).toContain('timeline-actions-capsule')
    expect(src).toContain('<GlassPressable')
    expect(src).not.toContain('<GlassButton')
    expect(src).not.toContain('HEADER_BUTTON_SIZE')
    expect(src).not.toContain('iconBtn')
    expect(src).not.toContain('colors.surface')
  })

  it('the overlay discs are GlassButtons', () => {
    const src = read('components/camera/OverlayDiscGroup.tsx')
    expect(src).toContain('<GlassButton')
    expect(src).not.toContain('<Pressable')
  })

  it('the floating timeline bar is one GlassSurface of GlassPressables', () => {
    const src = read('components/camera/theater/TimelineFloatingTools.tsx')
    expect(src).toContain('<GlassSurface')
    expect(src).toContain('<GlassPressable')
    expect(src).not.toContain('<GlassButton')
  })
})

describe('the tab bar wash', () => {
  it('is more opaque than the floating pills, in both themes', () => {
    for (const theme of ['dark', 'light'] as const) {
      expect(GLASS.bar.alpha[theme]).toBeGreaterThan(GLASS.tintAlpha[theme])
    }
  })

  it('is cut from a darker palette key than the pill wash', () => {
    expect(GLASS.bar.tone.dark).toBe('background')
    expect(GLASS.bar.tone.light).toBe('surfaceHover')
  })

  it('the bar asks for it and Reduce Transparency still resolves to a solid', () => {
    expect(read('navigation/BottomNavBar.tsx')).toContain('<GlassSurface variant="bar"')
    const surface = read('components/ui/GlassSurface.tsx')
    expect(surface).toMatch(/reduced\s*\?\s*variant === 'bar'/)
  })
})
