import { act, cleanup, render } from '@testing-library/react'
import { createElement, useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  hostBoxOnFit,
  hostBoxOnResize,
  initialHostBox,
  useHostBox,
  type HostBoxHandle,
} from '../use-host-box'

/**
 * The player box follows the WINDOW until a host fits it, then the host only.
 *
 * Operator report 2026-10-07: fullscreen on the hosted PWA left the camera the
 * same size. The browser host (an iframe at 100%) never calls `fit`, and the
 * page read the window once at mount — the iframe grew and the player did not.
 */
describe('host box rules', () => {
  const start = initialHostBox({ w: 796, h: 447 })

  it('follows a window resize while no host has fitted', () => {
    expect(hostBoxOnResize(start, { w: 1512, h: 982 })).toEqual({ box: { w: 1512, h: 982 }, hostOwned: false })
  })

  it('ignores the window once the host has fitted — WKWebView innerHeight lies on rotation', () => {
    const fitted = hostBoxOnFit(start, { w: 932, h: 430 })
    expect(hostBoxOnResize(fitted, { w: 430, h: 932 })).toBe(fitted)
  })

  it('refuses a degenerate measurement and keeps the same state for an unchanged one', () => {
    expect(hostBoxOnResize(start, { w: 0, h: 0 })).toBe(start)
    expect(hostBoxOnResize(start, { w: 796, h: 447 })).toBe(start)
  })
})

function setWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true })
}

function mount(): { current: HostBoxHandle | null } {
  const seen: { current: HostBoxHandle | null } = { current: null }
  function Harness(): null {
    const handle = useHostBox()
    useEffect(() => {
      seen.current = handle
    })
    return null
  }
  render(createElement(Harness))
  return seen
}

describe('useHostBox', () => {
  afterEach(() => cleanup())

  it('grows with the iframe when the browser goes fullscreen', () => {
    setWindow(796, 447)
    const seen = mount()
    expect(seen.current?.box).toEqual({ w: 796, h: 447 })
    act(() => {
      setWindow(1512, 982)
      window.dispatchEvent(new Event('resize'))
    })
    expect(seen.current?.box).toEqual({ w: 1512, h: 982 })
  })

  it('keeps the host-fitted box across a window resize', () => {
    setWindow(430, 932)
    const seen = mount()
    act(() => seen.current?.fit(932, 430))
    act(() => {
      setWindow(430, 900)
      window.dispatchEvent(new Event('resize'))
    })
    expect(seen.current?.box).toEqual({ w: 932, h: 430 })
  })
})

describe('every player page sizes itself through useHostBox', () => {
  const pages = ['EmbedPlayerPage.tsx', 'EmbedGridPage.tsx', 'EmbedRecordingPage.tsx']
  it.each(pages)('%s never pins the box to the window it was born in', async (page) => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '..', '..', 'pages', page), 'utf8')
    expect(src).toContain('useHostBox()')
    expect(src).not.toMatch(/useState\(\{\s*w: window\.innerWidth/)
  })
})
