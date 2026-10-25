import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where the browser has no Fullscreen API, the fullscreen disc drives the
 * app's own `fill`.
 *
 * `CameraDetailScreen` routed web to `toggleWebFullscreen()` ONLY, and the hook
 * silently returned when `requestFullscreen` was not a function. iPhone Safari
 * (browser and installed PWA) has no such function, so the disc was dead there
 * — nothing happened, no error, and the only path to a big picture was to
 * rotate the phone. The `fill` layout already does everything a PWA needs
 * from fullscreen (rail hidden, picture = window; there is no browser chrome
 * to hide), so it is the fallback.
 *
 * The mirror effect is guarded for the same reason: with the API absent,
 * `document.fullscreenElement` is always null, and an unguarded mirror wrote
 * `false` over the manual flag on mount, so even a fallback would have been
 * undone.
 *
 * Source assertions — vitest runs `node` here, no renderer.
 */

const SRC = join(process.cwd(), 'src')
const screen = readFileSync(join(SRC, 'screens', 'CameraDetailScreen.tsx'), 'utf8')

function block(from: string, to: string): string {
  const start = screen.indexOf(from)
  expect(start, `\`${from}\` must exist in the screen`).toBeGreaterThan(-1)
  const end = screen.indexOf(to, start)
  expect(end, `\`${to}\` must follow \`${from}\``).toBeGreaterThan(start)
  return screen.slice(start, end)
}

describe('the fullscreen disc on web', () => {
  const toggle = block('const onToggleFullscreen = useCallback', 'useEffect(')

  it('asks the hook whether the browser API is supported before using it', () => {
    expect(screen).toMatch(/supported: webFullscreenSupported/)
    expect(toggle).toMatch(/Platform\.OS === 'web' && webFullscreenSupported/)
  })

  it('falls back to the app-owned `fill` where the API is absent', () => {
    // The unsupported branch must reach the manual flag — the same line native
    // uses — not return early.
    expect(toggle).toContain('setFullscreen((f) => !f)')
    expect(toggle).not.toMatch(/if \(Platform\.OS === 'web'\) \{\s*toggleWebFullscreen\(\)\s*return\s*\}/)
  })

  it('mirrors the browser state into `fullscreen` only when the API is supported', () => {
    const mirror = block('useEffect(() => {\n    if (Platform.OS === \'web\'', '}, [webIsFullscreen')
    expect(mirror).toMatch(/Platform\.OS === 'web' && webFullscreenSupported/)
    expect(mirror).not.toMatch(/if \(Platform\.OS === 'web'\) setFullscreen\(webIsFullscreen\)/)
  })
})
