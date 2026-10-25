import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Facts about the SOURCE of the camera screen's zoom geometry. They cannot be
 * mount-tested: the box height is an animated style react-native-web hides in
 * a class, and a worklet is indistinguishable from a function under the stub.
 *
 * On iOS the live picture is a WKWebView. A `transform` on its wrapper is
 * composited on the GPU; a change to its FRAME is a WebKit re-layout, an IPC
 * to the content process and a `fit()` into the page. So:
 *
 *  - the wrapper the player lives in is a CONSTANT per layout mode — it never
 *    reads the animated box height;
 *  - the box's height follows the LIVE pinch scale, analytically, with no
 *    animation of its own: growth that ran after the release (1.0.478) made
 *    the picture keep going once the fingers had lifted — the operator's
 *    "continua a ritornare in avanti";
 *  - the growth is folded into the zoom transform by the hook, from the SAME
 *    height rule the box uses — one size, one source;
 *  - the double-tap step stays on the UI thread.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
const SCREEN = stripComments(
  readFileSync(join(__dirname, '..', '..', 'CameraDetailScreen.tsx'), 'utf-8'),
)
const HOOK = stripComments(
  readFileSync(join(__dirname, '..', '..', '..', 'live', 'use-stream-zoom.ts'), 'utf-8'),
)

function block(source: string, opener: string, closer: string): string {
  const start = source.indexOf(opener)
  expect(start, `${opener} is present`).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(closer, start)
  expect(end, `${opener} closes with ${closer}`).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('the live box grows under the fingers, the player never changes frame', () => {
  it('the box height follows the LIVE scale with no animation of its own', () => {
    const body = block(SCREEN, 'const liveBoxHeight = useDerivedValue(', '\n  }, [')
    expect(body).toContain('zoom.scale.value')
    expect(body).not.toContain('committedScale')
    expect(body).not.toContain('withTiming(')
  })

  it('the wrapper is a constant per mode: it never reads the animated box height', () => {
    const body = block(SCREEN, 'const videoCoverStyle = useAnimatedStyle(', '\n  }, [')
    expect(body).not.toContain('liveBoxHeight')
    expect(body).not.toContain('zoom.')
  })

  it('ONE height rule feeds the box, the clamp and the folded transform', () => {
    expect(SCREEN).toMatch(/heightFor: zoomBoxHeightFor/)
    expect(block(SCREEN, 'const liveBoxHeight = useDerivedValue(', '\n  }, [')).toContain('zoomBoxHeightFor(')
    const style = block(HOOK, 'const videoStyle = useAnimatedStyle(', '\n  })')
    expect(style).toContain('foldGrowth(')
    expect(style).toContain('heightFor(')
    expect(HOOK).not.toContain('onLayout')
  })

  it('the double tap stays on the UI thread', () => {
    expect(SCREEN).not.toMatch(/runOnJS\(zoom\.doubleTapZoomAt\)/)
    expect(SCREEN).toMatch(/zoom\.doubleTapZoomAt\(e\.x, e\.y\)/)
    const step = HOOK.slice(HOOK.indexOf('const doubleTapZoomAt = useCallback('))
    expect(step.slice(0, 200)).toContain("'worklet'")
  })
})
