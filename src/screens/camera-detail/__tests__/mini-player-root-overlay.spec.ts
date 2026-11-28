import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The in-app mini-player is a ROOT OVERLAY, never a route and never a modal.
 *
 * This replaces `no-in-app-pip.spec.ts`, which pinned the mini-player's
 * deletion (operator decision 2026-11-28: it comes back, as this).
 *
 * The mini-player shipped twice as a shrunk-in-place copy of the camera route
 * and both times left the app underneath un-tappable: a `transparentModal`
 * presentation ate touches, then a blurred tab screen froze behind a stacked
 * route. Both defects share one cause — the player was PART OF THE NAVIGATOR,
 * so it inherited the navigator's presentation, focus and freeze rules. The rule
 * that prevents the whole class: the player is a sibling AFTER the `<Stack>`,
 * outside every screen lifecycle, and the only thing in it that takes a touch
 * is the floating box (`box-none` everywhere else).
 *
 * `components/camera/__tests__/mini-player-host-mount.spec.ts` mounts it and
 * proves the touch half; this file pins the placement half by source text.
 */

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.') || entry === '__tests__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sources(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const layout = read('app/(app)/_layout.tsx')
const host = read('src/components/camera/OnDemandPlayerHost.tsx')
const player = read('src/components/camera/OnDemandPlayer.tsx')

/** The code of a file with `//` and block comments removed, so prose cannot satisfy or trip a check. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the mini-player is hosted at the app root, after the navigator', () => {
  it('is rendered as a sibling AFTER <Stack>, in the same positioned parent', () => {
    const stack = layout.indexOf('<Stack')
    const hostAt = layout.indexOf('<OnDemandPlayerHost />')
    expect(stack).toBeGreaterThan(-1)
    expect(hostAt).toBeGreaterThan(stack)
    // Not inside the Stack: no Stack.Screen element wraps or names it.
    expect(code(layout)).not.toMatch(/<Stack\.Screen[^>]*OnDemand/)
  })

  it('is not a route: no file under app/ is the player', () => {
    const files = sources(join(ROOT, 'app')).map((f) => f.slice(ROOT.length + 1))
    expect(files.filter((f) => /on-?demand|mini-?player|in-?app-?pip/i.test(f))).toEqual([])
  })

  it('is never presented by the navigator: no modal presentation names it', () => {
    // The one file allowed to name it is the layout that hosts it (asserted above).
    for (const file of sources(join(ROOT, 'app')).filter(
      (f) => !f.endsWith(join('(app)', '_layout.tsx')),
    )) {
      const src = code(readFileSync(file, 'utf8'))
      expect(src, file).not.toMatch(/OnDemand|mini-?player/i)
    }
  })

  it('draws no Modal of its own — a Modal is a second window that eats touches', () => {
    for (const src of [code(host), code(player)]) {
      expect(src).not.toMatch(/\bModal\b/)
      expect(src).not.toMatch(/SheetModal/)
      expect(src).not.toMatch(/ransparentModal/)
    }
  })
})

describe('the touches pass through to the app underneath', () => {
  it('the host fills the window as box-none, so only the floating box takes a touch', () => {
    expect(code(host)).toMatch(/pointerEvents="box-none"[\s\S]*StyleSheet\.absoluteFill/)
  })

  it('the host reads nothing from the navigator state that could freeze or unmount it', () => {
    // `usePathname` is read ONLY to keep the corners clear of the route's bars.
    expect(code(host)).not.toMatch(/useSegments|useNavigation|useFocusEffect|useIsFocused/)
  })

  it('the panel is absolutely positioned, so it adds no flow box over the app', () => {
    expect(player).toMatch(/panel: \{\s*position: 'absolute'/)
  })
})

describe('the system PiP stays one request', () => {
  const screen = read('src/screens/CameraDetailScreen.tsx')

  it('no kind parameter survives, and no single-member union of one', () => {
    expect(screen).not.toMatch(/'system'\s*\|\s*'in-app'/)
    expect(screen).not.toMatch(/requestPip\(\s*'/)
    expect(screen).not.toContain('pipAfterLiveRef')
  })

  it('the route-era mini-player symbols stay gone', () => {
    const files = [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'app'))]
    for (const symbol of [
      'inAppPip',
      'InAppPip',
      'in-app-pip',
      'PipRect',
      'enterInAppPip',
      'exitInAppPip',
    ]) {
      const hits = files.filter((f) => readFileSync(f, 'utf8').includes(symbol))
      expect(
        hits.map((f) => f.slice(ROOT.length + 1)),
        symbol,
      ).toEqual([])
    }
  })
})

describe('the route-era strings are gone from BOTH locales', () => {
  for (const locale of ['en', 'it']) {
    it(`${locale}.json has no orphan mini-player copy`, () => {
      const raw = read(`locales/${locale}.json`)
      expect(raw).not.toContain('inAppPip')
      expect(raw).not.toContain('closePip')
      // The system PiP disc keeps its label — that one is still on screen.
      expect(raw).toContain('"pip"')
    })
  }
})

describe('the resize grip wins over the header move', () => {
  it('is a child of the header View and carries its own responder', () => {
    const player = code(read('src/components/camera/OnDemandPlayer.tsx'))
    const header = player.indexOf('{...moveResponder.panHandlers}')
    const grip = player.indexOf('{...resizeResponder.panHandlers}')
    const headerEnd = player.indexOf('</View>', grip)
    expect(header).toBeGreaterThan(-1)
    expect(grip).toBeGreaterThan(header)
    // nothing closes the header between its opening tag and the grip's handlers
    expect(player.slice(header, grip)).not.toMatch(/<\/View>\s*<Pressable[^>]*onPress=\{onClose/)
    expect(headerEnd).toBeGreaterThan(grip)
  })
})
