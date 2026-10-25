/**
 * @vitest-environment jsdom
 *
 * The camera page's chrome, held to the operator's two complaints (2026-10-23):
 *
 * 1. "The buttons on the stream sometimes lose their background." Every
 *    on-video disc mounts under two fades inside a glass group, and iOS does not
 *    always draw a native glass that appears under an ancestor at opacity 0 —
 *    the mute and PiP discs were bare glyphs on the picture. Every disc, in
 *    every state, must go through the ONE glass button and ask for the `dense`
 *    wash, which is drawn inside the surface whether or not the system glass is.
 * 2. "The header buttons don't use the app's theme." The status glyphs wore
 *    `info` blue (charging) and the muted caption tone next to controls drawn in
 *    the icon colour. Neutral = the icon colour; only a real warning is coloured.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import '../../../app/i18n.js'
import { ThemeProvider } from '../../../theme/theme-provider.js'
import { THEME } from '../../../theme/tokens.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import { batteryBadgeColor } from '../BatteryBadge.js'
import { denseWash } from '../../ui/GlassSurface.js'

vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }))

interface RecordedGlassButton {
  readonly label: string
  readonly dense?: boolean
  readonly children?: React.ReactNode
}

// The glass button stands in as a marker: a disc drawn by anything else would
// not carry `data-glass`, and one that forgot `dense` would say so.
vi.mock('../../ui/GlassButton.js', () => ({
  GLASS_BUTTON_SIZE: 40,
  GlassButton: ({ label, dense, children }: RecordedGlassButton) =>
    React.createElement(
      'div',
      { 'data-glass': 'button', 'data-dense': String(dense === true), 'aria-label': label },
      children,
    ),
}))

const { StreamOverlayControls } = await import('../StreamOverlayControls.js')

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

const noop = (): void => {}

interface DiscState {
  readonly name: string
  readonly muted: boolean
  readonly talking: boolean
  readonly paused: boolean
  readonly showPlayPause: boolean
  readonly fullscreen: boolean
  readonly withTimeline: boolean
  readonly withAudioNotice: boolean
  readonly discs: number
}

// mute · talk · [timeline] · [play] · pip · fullscreen
const STATES: readonly DiscState[] = [
  { name: 'muted, idle (the screenshot)', muted: true, talking: false, paused: false, showPlayPause: false, fullscreen: false, withTimeline: false, withAudioNotice: false, discs: 4 },
  { name: 'unmuted, talking', muted: false, talking: true, paused: false, showPlayPause: false, fullscreen: false, withTimeline: false, withAudioNotice: false, discs: 4 },
  { name: 'paused, play disc shown', muted: true, talking: false, paused: true, showPlayPause: true, fullscreen: false, withTimeline: false, withAudioNotice: false, discs: 5 },
  { name: 'fullscreen with the timeline toggle', muted: false, talking: false, paused: false, showPlayPause: true, fullscreen: true, withTimeline: true, withAudioNotice: false, discs: 6 },
  { name: 'silent by speed (badge)', muted: false, talking: false, paused: false, showPlayPause: false, fullscreen: false, withTimeline: false, withAudioNotice: true, discs: 4 },
]

function mountDiscs(state: DiscState) {
  return render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(StreamOverlayControls, {
        visible: true,
        onRequestHide: noop,
        paused: state.paused,
        onTogglePause: noop,
        showPlayPause: state.showPlayPause,
        muted: state.muted,
        onToggleMute: noop,
        hasTwoWayAudio: true,
        talking: state.talking,
        onToggleTalk: noop,
        onStartSystemPip: noop,
        fullscreen: state.fullscreen,
        onToggleFullscreen: noop,
        ...(state.withTimeline ? { timelineToggle: { dock: 'off' as const, onSet: noop } } : {}),
        ...(state.withAudioNotice ? { audio: { kind: 'silent-by-speed' as const, rate: 4 } } : {}),
      }),
    ),
  )
}

describe('every on-video disc is the dense glass button, in every state', () => {
  for (const state of STATES) {
    it(state.name, () => {
      const { container } = mountDiscs(state)
      const glass = Array.from(container.querySelectorAll('[data-glass="button"]'))
      expect(glass).toHaveLength(state.discs)
      for (const disc of glass) expect(disc.getAttribute('data-dense')).toBe('true')
      // The two the operator saw bare are among them.
      expect(screen.getByLabelText(/^(Mute|Unmute|No sound at .*)$/)).toBeTruthy()
      expect(screen.getByLabelText(/^Picture in picture$/i)).toBeTruthy()
    })
  }
})

describe('the dense wash', () => {
  it('a floating surface gets the blur fallback wash; a bar keeps the bar wash', () => {
    expect(denseWash({ bar: null, fill: 'FILL' })).toBe('FILL')
    expect(denseWash({ bar: 'BAR', fill: 'FILL' })).toBe('BAR')
  })

  it('the native glass draws the dense wash and the tint inside the surface', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/ui/GlassSurface.tsx'), 'utf8')
    const native = src.slice(src.indexOf('<NativeGlass'), src.indexOf('</NativeGlass>'))
    expect(native).toMatch(/denseWash\(look\)/)
    expect(native).toMatch(/\{dense \? wash : null\}/)
  })
})

describe('the header status glyphs wear the theme', () => {
  for (const mode of ['light', 'dark'] as const) {
    const colors = THEME[mode]
    it(`${mode}: charging and healthy are the icon colour, low is danger, never info`, () => {
      expect(batteryBadgeColor({ charging: 'dc', percentage: 80 }, colors, 'foreground')).toBe(colors.foreground)
      expect(batteryBadgeColor({ charging: 'solar', percentage: 10 }, colors, 'foreground')).toBe(colors.foreground)
      expect(batteryBadgeColor({ charging: 'none', percentage: 70 }, colors, 'foreground')).toBe(colors.foreground)
      expect(batteryBadgeColor({ charging: 'none', percentage: 15 }, colors, 'foreground')).toBe(colors.danger)
    })
  }

  it('the toolbar asks every status glyph for the icon colour, and its date pill too', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/camera/theater/TimelineToolbarInline.tsx'), 'utf8')
    expect(src.match(/neutral="foreground"/g)).toHaveLength(3)
    expect(src).not.toMatch(/colors\.(info|foregroundMuted)\b/)
  })

  it('a weak link is a warning, not a failure', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/camera/NetworkLinkBadge.tsx'), 'utf8')
    expect(src).toMatch(/weak \? colors\.warning : colors\[neutral\]/)
  })
})
