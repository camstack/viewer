/**
 * No gesture that runs on the JS thread (`.runOnJS(true)`) drives its own state
 * (`.manualActivation(...)` + `state.activate()` / `state.fail()`).
 *
 * On native, react-native-gesture-handler's touch-event state manager is
 * Reanimated's `setGestureState`, which works only inside a UI-thread worklet:
 * called from the JS runtime it logs "You can not use setGestureState in
 * non-worklet function." and does NOTHING. The web build has its own manager, so
 * a browser — and every Playwright test — works, while on a phone the gesture
 * never activates. That is how the retrain editor shipped with no drawing,
 * moving or resizing on phones. A JS-thread gesture activates on its built-in
 * criteria (`minDistance`, …); a manually-activated one is a worklet.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const SCANNED = ['src', 'app']

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Each `Gesture.X()` builder chain, as the text up to the next one. */
function gestureChains(text: string): string[] {
  return text.split(/\bGesture\.(?=[A-Z])/).slice(1)
}

function offendingChains(text: string): string[] {
  return gestureChains(text).filter(
    (chain) =>
      /\.runOnJS\(\s*true\s*\)/.test(chain) &&
      (/\.manualActivation\(\s*true\s*\)/.test(chain) || /\b\w+\.(activate|fail)\(\)/.test(chain)),
  )
}

describe('JS-thread gestures never use the state manager', () => {
  it('flags the pattern that broke the retrain editor on phones', () => {
    const broken = `Gesture.Pan().runOnJS(true).manualActivation(true).onTouchesMove((e, state) => { state.activate() })`
    expect(offendingChains(broken)).toHaveLength(1)
    const worklet = `Gesture.Pan().manualActivation(true).onTouchesMove((e, state) => { 'worklet'; state.activate() })`
    expect(offendingChains(worklet)).toHaveLength(0)
    const auto = `Gesture.Pan().runOnJS(true).minDistance(6).onUpdate(() => {})`
    expect(offendingChains(auto)).toHaveLength(0)
  })

  it('holds for every source file', () => {
    const offenders = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .filter((file) => offendingChains(readFileSync(file, 'utf8')).length > 0)
      .map((file) => relative(ROOT, file))
    expect(offenders).toEqual([])
  })
})
