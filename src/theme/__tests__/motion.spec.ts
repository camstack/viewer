import { beforeEach, describe, expect, it, vi } from 'vitest'

const withSpring = vi.hoisted(() => vi.fn((to: number, config: unknown) => ({ spring: to, config })))
const withTiming = vi.hoisted(() => vi.fn((to: number, config: unknown) => ({ timing: to, config })))

vi.mock('react-native-reanimated', () => ({
  withSpring,
  withTiming,
  useReducedMotion: () => false,
  Easing: { inOut: (fn: unknown) => fn, ease: (t: number) => t },
}))

import { GLASS_PRESS } from '../../components/ui/glass-press.js'
import {
  MOTION,
  MOTION_EASE,
  controlsTransitions,
  dockTransitions,
  menuOrigin,
  popTransitions,
  springTo,
  timingTo,
} from '../motion.js'

beforeEach(() => {
  withSpring.mockClear()
  withTiming.mockClear()
})

describe('the motion presets', () => {
  it('pins the press, the tab pill, the fades and the sheet', () => {
    expect(MOTION.press).toEqual({
      rest: { scale: 1, opacity: 1 },
      pressed: { scale: 0.92, opacity: 0.85 },
      spring: { damping: 18, stiffness: 420, mass: 0.7 },
    })
    expect(MOTION.tabPill.spring).toEqual({ damping: 20, stiffness: 260, mass: 0.9 })
    expect(MOTION.crossFade.ms).toBe(160)
    expect(MOTION.appear.ms).toBe(160)
    expect(MOTION.disappear.ms).toBe(160)
    expect(MOTION.sheet.ms).toBe(220)
  })

  it('the glass press table IS the motion press preset, not a copy', () => {
    expect(GLASS_PRESS).toBe(MOTION.press)
  })
})

describe('springTo / timingTo', () => {
  it('spring with the given preset (the press one by default)', () => {
    springTo(0.92, false)
    expect(withSpring).toHaveBeenCalledWith(0.92, MOTION.press.spring)
    springTo(40, false, MOTION.tabPill.spring)
    expect(withSpring).toHaveBeenLastCalledWith(40, MOTION.tabPill.spring)
  })

  it('ease over the duration with the standard curve', () => {
    timingTo(1, MOTION.sheet.ms, false)
    expect(withTiming).toHaveBeenCalledWith(1, { duration: 220, easing: MOTION_EASE })
  })

  it('under Reduce Motion the value lands on its target and nothing animates', () => {
    expect(springTo(0.92, true)).toBe(0.92)
    expect(timingTo(1, 220, true)).toBe(1)
    expect(withSpring).not.toHaveBeenCalled()
    expect(withTiming).not.toHaveBeenCalled()
  })
})

describe('the glass transitions', () => {
  it('pins pop, menu, controls and dock', () => {
    expect(MOTION.pop).toEqual({ spring: { damping: 16, stiffness: 380, mass: 0.7 }, fromScale: 0.8, fadeMs: 140 })
    expect(MOTION.menu).toEqual({ spring: { damping: 22, stiffness: 420, mass: 0.8 }, fromScale: 0.9, fadeMs: 140 })
    expect(MOTION.controls).toEqual({ fadeInMs: 180, fadeOutMs: 220 })
    expect(MOTION.dock.fadeMs).toBe(200)
  })

  it('hand out entering/exiting, and nothing at all under Reduce Motion', () => {
    for (const make of [popTransitions, controlsTransitions, dockTransitions]) {
      const on = make(false)
      expect(typeof on.entering).toBe('function')
      expect(typeof on.exiting).toBe('function')
      expect(make(true)).toEqual({})
    }
  })

  it('a pop enters from scale 0.8 / opacity 0 and springs to rest', () => {
    const layout = popTransitions(false).entering?.({} as never) as unknown as {
      initialValues: { opacity: number; transform: { scale: number }[] }
    }
    expect(layout.initialValues).toEqual({ opacity: 0, transform: [{ scale: 0.8 }] })
    expect(withSpring).toHaveBeenCalledWith(1, MOTION.pop.spring)
  })
})

describe('menuOrigin — a menu grows out of its anchor', () => {
  const menu = { left: 100, width: 240 }

  it('is the edge facing the trigger, under its centre', () => {
    expect(menuOrigin({ x: 150, width: 40 }, menu, 'below')).toEqual({ x: 70, y: '0%' })
    expect(menuOrigin({ x: 150, width: 40 }, menu, 'above')).toEqual({ x: 70, y: '100%' })
  })

  it('stays inside the menu when the trigger is wider or off to a side', () => {
    expect(menuOrigin({ x: 0, width: 20 }, menu, 'below').x).toBe(0)
    expect(menuOrigin({ x: 900, width: 20 }, menu, 'below').x).toBe(240)
  })
})
