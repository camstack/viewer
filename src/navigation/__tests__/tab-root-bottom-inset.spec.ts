import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { scrollBottomPadding } from '../bottom-nav-inset.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const APP_TABS = path.resolve(SRC, '..', 'app', '(app)', '(tabs)')
const read = (p: string): string => readFileSync(p, 'utf8')

describe('the bottom inset rule', () => {
  it('adds the capsule footprint to the scroller\'s own padding, never subtracts', () => {
    expect(scrollBottomPadding(16, 86)).toBe(102)
    expect(scrollBottomPadding(16, 0)).toBe(16)
    expect(scrollBottomPadding(16, -5)).toBe(16)
  })
})

/** Tab route file -> the screen it mounts and the files whose scrollers it owns. */
const TAB_ROOTS: Readonly<Record<string, readonly string[]>> = {
  'cameras.tsx': ['screens/CamerasScreen.tsx'],
  'grids.tsx': ['screens/GridsScreen.tsx'],
  'events.tsx': [
    'components/events/gallery/EventsGallery.tsx',
    'screens/artifacts/ArtifactsScreen.tsx',
    'screens/faces/FaceReviewScreen.tsx',
    'screens/retrain/RetrainScreen.tsx',
  ],
  'notifications.tsx': ['screens/notifications/NotificationCenterScreen.tsx'],
  'settings.tsx': ['screens/SettingsScreen.tsx'],
}

describe('every tab root clears the floating capsule', () => {
  it('the table covers every tab route file', () => {
    const files = readdirSync(APP_TABS).filter((f) => f !== '_layout.tsx')
    expect(files.sort()).toEqual(Object.keys(TAB_ROOTS).sort())
  })

  for (const [route, screens] of Object.entries(TAB_ROOTS)) {
    it(`${route}: its scrollers read the shared inset`, () => {
      for (const screen of screens) {
        const src = read(path.join(SRC, screen))
        expect(src, screen).toMatch(/useTabScrollPadding|useBottomNavInset/)
      }
    })
  }

  it('Library does not shorten its box for any section: Events scrolls under the bar too', () => {
    const src = read(path.join(SRC, 'screens/LibraryScreen.tsx'))
    expect(src).not.toMatch(/paddingBottom/)
    expect(src).not.toContain('useBottomNavInset')
  })

  it('the Events gallery pads its content by the capsule and insets its scroll indicator', () => {
    const src = read(path.join(SRC, 'components/events/gallery/EventsGallery.tsx'))
    expect(src).toMatch(/useTabScrollPadding\(/)
    expect(src).toContain('scrollIndicatorInsets={indicatorInsets}')
  })
})
