import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_TIMELINE_DOCK,
  isTimelineDock,
  nextTimelineDock,
  sideTimelineWidth,
  streamWidthFor,
  timelineDockLabelKey,
  timelineShown,
  type TimelineDock,
} from '../timeline-dock.js'
import { SETTINGS_LEVELS } from '../../../../store/settings-levels.js'
import { drawerWidth } from '../landscape-drawer-geometry.js'

const read = (...p: string[]): string => readFileSync(join(__dirname, '..', ...p), 'utf8')
const JSON_ROOT = join(__dirname, '..', '..', '..', '..', '..', 'locales')

describe('the three-state timeline button', () => {
  it('cycles off → overlay → side → off', () => {
    const seq: TimelineDock[] = ['off']
    for (let i = 0; i < 3; i += 1) seq.push(nextTimelineDock(seq[seq.length - 1]!))
    expect(seq).toEqual(['off', 'overlay', 'side', 'off'])
  })

  it('starts hidden, and only off hides the timeline', () => {
    expect(DEFAULT_TIMELINE_DOCK).toBe('off')
    expect(timelineShown('off')).toBe(false)
    expect(timelineShown('overlay')).toBe(true)
    expect(timelineShown('side')).toBe(true)
  })

  it('validates what it reads back from storage', () => {
    expect(isTimelineDock('side')).toBe(true)
    expect(isTimelineDock('docked')).toBe(false)
    expect(isTimelineDock(undefined)).toBe(false)
  })

  it('has a distinct label per state in both languages', () => {
    for (const lang of ['en', 'it']) {
      const dock = (JSON.parse(readFileSync(join(JSON_ROOT, `${lang}.json`), 'utf8')) as {
        v2: { timeline: { dock: Record<string, string> } }
      }).v2.timeline.dock
      expect(new Set(Object.values(dock)).size).toBe(3)
      for (const state of ['off', 'overlay', 'side'] as const) {
        expect(dock[state], `${lang}.${state}`).toBeTruthy()
        expect(timelineDockLabelKey(state)).toBe(`v2.timeline.dock.${state}`)
      }
    }
  })

  it('is remembered on this device', () => {
    expect(SETTINGS_LEVELS.stream.landscapeTimeline).toBe('device')
  })
})

describe('side layout numbers', () => {
  it.each([
    [844, 390],
    [932, 430],
    [1180, 820],
  ])('%ix%i: the stream keeps the rest of the width, the column is the drawer width', (w) => {
    const column = sideTimelineWidth(w)
    expect(column).toBe(drawerWidth(w))
    expect(streamWidthFor(w, 'side')).toBe(w - column)
    expect(streamWidthFor(w, 'overlay')).toBe(w)
    expect(streamWidthFor(w, 'off')).toBe(w)
    // A usable column and a stream that is still most of the screen.
    expect(column).toBeGreaterThanOrEqual(240)
    expect(streamWidthFor(w, 'side')).toBeGreaterThan(w / 2)
  })
})

describe('the screen wires the dock', () => {
  const screen = readFileSync(join(__dirname, '..', '..', '..', '..', 'screens', 'CameraDetailScreen.tsx'), 'utf8')
  it('shrinks the picture box and animates it from one shared value', () => {
    expect(screen).toContain('sideProgress')
    expect(screen).toContain('boxSideStyle')
    expect(screen).toContain('useReducedMotion')
    expect(screen).toContain('drawerBeside={timelineBeside}')
  })
  it('the drawer paints the page, not the scrim, when beside', () => {
    expect(read('LandscapeTimelineOverlay.tsx')).toContain('beside ?')
  })
})
