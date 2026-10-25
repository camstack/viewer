/**
 * A source guard for the two wirings that make the tablet-landscape rule TRUE
 * at runtime. The pure matrix next door proves the rule; nothing but this proves
 * the screens still feed it — and both defects it pins were invisible to types.
 *
 *  1. `CameraDetailScreen` must hand the resolver the DEVICE screen's shortest
 *     side. Without it the resolver falls back to the window, whose height the
 *     soft keyboard shrinks — and a motionless landscape tablet loses its rail
 *     mid-typing. That is the reported oscillation.
 *
 *  2. `GridViewScreen` must not force PORTRAIT on the way out. It used to call
 *     `lockAsync(PORTRAIT_UP)` unconditionally in its unmount cleanup, which is
 *     an APP-WIDE lock: on a tablet held in landscape, closing any grid — the
 *     adhoc grid is opened FROM the camera timeline — rotated the whole app to
 *     portrait, so the theater legitimately resolved to `stack` and the operator
 *     saw the timeline drop under the picture. The camera screen's own
 *     `unlockAsync` runs on mount, so a detail screen still mounted underneath
 *     never undid it: the layout stayed wrong until the screen was re-entered.
 *     Exactly the "spesso cambia" the report describes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const DETAIL_SCREEN = readFileSync(join(SRC, 'screens', 'CameraDetailScreen.tsx'), 'utf8')
const GRID_SCREEN = readFileSync(join(SRC, 'screens', 'GridViewScreen.tsx'), 'utf8')

describe('the theater asks the device, not the shrinkable window', () => {
  it('the screen reads the device screen size and passes it to the resolver', () => {
    expect(DETAIL_SCREEN).toMatch(/useScreenMinSide\(\)/)
    // The input is built as `layoutInput` and handed to the resolver, so the
    // guard follows the value rather than the call site's punctuation.
    expect(DETAIL_SCREEN).toMatch(/const layoutInput = \{[\s\S]{0,200}screenMinSide/)
    expect(DETAIL_SCREEN).toMatch(/resolveDetailLayoutMode\(layoutInput\)/)
  })
})

describe('the theater owns its orientation for as long as it is on screen', () => {
  it('applies it through the focus-driven hook, not a mount-only effect', () => {
    // A `useEffect` keyed on `[fullscreen]` cannot fire when a pushed route
    // pops: `freezeOnBlur: false` leaves this screen mounted, so a lock left
    // behind by the route on top stayed in force. Behaviour is pinned by
    // `hooks/__tests__/theater-orientation.spec.ts`; this only proves the
    // screen still goes through it.
    expect(DETAIL_SCREEN).toMatch(/useTheaterOrientation\(fullscreen,\s*\{\s*screenMinSide\s*\}\)/)
    expect(DETAIL_SCREEN).not.toMatch(/ScreenOrientation\.(lock|unlock)Async/)
  })
})

describe('no screen force-rotates a tablet to portrait', () => {
  it('the grid restores portrait only through the shared rule', () => {
    expect(GRID_SCREEN).toMatch(/shouldRestorePortraitLock\(/)
  })

  it('the theater exit restores portrait only through the same shared rule', () => {
    // Portrait-on-exit lives inside `use-theater-orientation.ts`, gated by
    // `shouldRestorePortraitLock` — never an unconditional PORTRAIT_UP here.
    const theater = readFileSync(
      join(process.cwd(), 'src/hooks/use-theater-orientation.ts'),
      'utf8',
    )
    expect(theater).toMatch(/shouldRestorePortraitLock\(/)
    expect(theater).toMatch(/PORTRAIT_UP/)
  })

  it('the grid tells the rule whether it is on web', () => {
    // `useScreenMinSide()` is `undefined` on web, and the rule used to read
    // that as "phone" — so the hub-served viewer force-locked PORTRAIT on
    // every grid close. The platform has to be passed, not inferred.
    expect(GRID_SCREEN).toMatch(/shouldRestorePortraitLock\(\{[^}]*isWeb/)
  })

  it('the unconditional portrait lock is gone', () => {
    // The exact line that shipped the leak.
    expect(GRID_SCREEN).not.toMatch(
      /return \(\) => \{ void ScreenOrientation\.lockAsync\(ScreenOrientation\.OrientationLock\.PORTRAIT_UP\) \}/,
    )
  })

  it('no screen locks PORTRAIT without consulting the rule', () => {
    for (const source of [DETAIL_SCREEN, GRID_SCREEN]) {
      const locks = source.match(/OrientationLock\.PORTRAIT_UP/g) ?? []
      if (locks.length === 0) continue
      expect(source).toMatch(/shouldRestorePortraitLock\(/)
    }
  })
})
