/**
 * The loop reaches the bar, and the operator's answer reaches the hook.
 *
 * Three hops, each of which has been the silent one in this app before:
 *
 *  1. the SCREEN reads the persisted switch and hands it to `useClipStage`,
 *     which is where the end of a file is known and where the dial is made;
 *  2. the screen hands the bar a binding whose `onToggle` writes the SAME
 *     setting it read — one authority, so the chip cannot show a state the
 *     hook is not acting on (a second store for the switch is exactly the
 *     "two knobs that wrote a store nobody read" D62 names);
 *  3. the TIMELINE forwards it only where a file is on screen, off the same
 *     `clipsSurface.axis === 'clip'` statement `clipProgress` is gated on —
 *     the bar then has one statement, read twice, instead of two flags that
 *     can disagree.
 *
 * Source assertions, in the style of `overlay-ownership-wiring.spec.ts`: the
 * screen is 3k lines of hooks and cannot be mounted here.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('the screen owns the switch', () => {
  const src = read('screens/CameraDetailScreen.tsx')

  it('reads it from the persisted settings document', () => {
    expect(src).toContain('settings.stream.clipLoop')
  })

  it('hands it to the hook that knows the end of a file', () => {
    expect(src).toContain('useClipStage(clipStagePorts, clipLoop)')
  })

  it('and the toggle writes the very setting it read', () => {
    expect(src).toContain("setStreamDefault('clipLoop'")
  })

  it('binding and hook read ONE value', () => {
    expect(src).toContain('clipLoop={{ enabled: clipLoop, onToggle: onToggleClipLoop }}')
  })
})

describe('the timeline forwards it only where a file is on screen', () => {
  const src = read('components/camera/theater/TheaterTimeline.tsx')

  it('gated on the surface axis, exactly as the clip progress row is', () => {
    expect(src).toContain("clipLoop: clipsSurface.axis === 'clip' ? props.clipLoop : undefined")
  })
})
