import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { HEADER_BUTTON_SIZE } from '../screen-header-metrics.js'
import { GLASS_BUTTON_SIZE } from '../ui/GlassButton.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (name === '__tests__') return []
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : []
  })
}

const SCREENS = walk(path.join(SRC, 'screens')).map((file) => ({
  rel: path.relative(SRC, file),
  src: readFileSync(file, 'utf8'),
}))

describe('one header pattern', () => {
  it('the header button is the same size as every other glass button', () => {
    expect(HEADER_BUTTON_SIZE).toBe(GLASS_BUTTON_SIZE)
  })

  it('no screen renders its own back glyph: the back button is ScreenHeader\'s', () => {
    const offenders = SCREENS.filter((s) => /<(ChevronLeft|ArrowLeft)\b/.test(s.src)).map((s) => s.rel)
    expect(offenders).toEqual([])
  })

  it('a screen that goes back by itself wears the shared header (or the floating twin)', () => {
    // AddServerScreen: the sign-in flow has no app chrome yet. The detail
    // screens reach back through the stream chrome (CameraDetailScreen) or the
    // wall bar (GridViewScreen), which are glass buttons of their own.
    const EXEMPT = new Set([
      'screens/AddServerScreen.tsx',
      'screens/CameraDetailScreen.tsx',
    ])
    const offenders = SCREENS.filter(
      (s) =>
        /router\.back\(\)/.test(s.src) &&
        !EXEMPT.has(s.rel) &&
        !/ScreenHeader|EditorScroll|BackChip/.test(s.src),
    ).map((s) => s.rel)
    expect(offenders).toEqual([])
  })

  const MIGRATED: readonly string[] = [
    'screens/CamerasManageScreen.tsx',
    'screens/GridBuilderScreen.tsx',
    'screens/retrain/editor/RetrainEditorScreen.tsx',
    'screens/settings/SignInMethodsScreen.tsx',
    'screens/artifacts/ArtifactsScreen.tsx',
    'screens/notifications/NotificationCenterScreen.tsx',
    'screens/notifications/RuleHistoryScreen.tsx',
  ]
  for (const rel of MIGRATED) {
    it(`${rel} uses ScreenHeader`, () => {
      expect(SCREENS.find((s) => s.rel === rel)?.src).toContain('<ScreenHeader')
    })
  }

  it('header action buttons are declared as `actions`, never drawn as a Pressable in `right`', () => {
    for (const s of SCREENS) {
      expect(/<ScreenHeader[\s\S]*?right=\{\s*<(View|Pressable)/.test(s.src), s.rel).toBe(false)
    }
  })

  it('the GridView floating back is the header\'s glass button at the header\'s position', () => {
    const src = SCREENS.find((s) => s.rel === 'screens/GridViewScreen.tsx')?.src ?? ''
    // The SAME back button the app bar draws (`HeaderBackButton`), not a copy.
    expect(src).toContain('<HeaderBackButton')
    expect(readFileSync(path.join(SRC, 'components/ScreenHeader.tsx'), 'utf8')).toContain('<GlassButton icon={ChevronLeft}')
    expect(src).toContain('HEADER_PADDING_TOP')
  })

  it('ScreenHeader draws the back and the actions as GlassButtons', () => {
    const header = readFileSync(path.join(SRC, 'components/ScreenHeader.tsx'), 'utf8')
    // Back, the icon action, and the labelled (pill) primary action — every
    // one of them a GlassButton.
    expect(header.match(/<GlassButton/g)?.length).toBe(3)
    expect(header).toContain('shape="pill"')
    expect(header).not.toContain('<Pressable')
  })
})
