/**
 * A cover button pulses while the cover is MOVING, in the direction it moves.
 *
 * The operator pressed "down" on the Hall shutter and read "no effect". Two
 * things were wrong and only one of them was in this file: the Homematic
 * provider destroyed the `closing` state with its own position updates (fixed
 * in `homematic-decode.ts`), and nothing here said a move was under way beyond
 * a steady highlight that a closed shutter also wears.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = join(process.cwd(), 'src', 'components', 'camera', 'accessory-controls')
const controls = readFileSync(join(here, 'controls.tsx'), 'utf8')
const atoms = readFileSync(join(here, 'control-atoms.tsx'), 'utf8')

function coverBlock(): string {
  const start = controls.indexOf('export function CoverControl')
  expect(start).toBeGreaterThan(-1)
  return controls.slice(start, controls.indexOf('\n}\n', start))
}

describe('the pulse follows the direction of travel', () => {
  it('the OPEN button pulses only while opening', () => {
    const block = coverBlock()
    const up = block.slice(block.indexOf('icon={ChevronUp}'))
    expect(up.slice(0, up.indexOf('/>'))).toContain("pulsing={state === 'opening'}")
  })

  it('the CLOSE button pulses only while closing', () => {
    const block = coverBlock()
    const down = block.slice(block.indexOf('icon={ChevronDown}'))
    expect(down.slice(0, down.indexOf('/>'))).toContain("pulsing={state === 'closing'}")
  })

  it('a resting cover pulses nothing', () => {
    // `active` covers `open`/`closed` too — a steady highlight. Only the two
    // transient states may animate, or the button would pulse for ever on a
    // shutter that simply IS closed.
    const block = coverBlock()
    expect(block).not.toContain("pulsing={state === 'closed'")
    expect(block).not.toContain("pulsing={state === 'open'")
    expect(block).not.toContain('pulsing={true}')
  })
})

describe('the pulse itself', () => {
  it('stops AND resets when the move ends', () => {
    // A loop left at its trough leaves the button permanently half-lit, which
    // reads as disabled — the exact confusion this change exists to end.
    const effect = atoms.slice(atoms.indexOf('if (pulsing !== true)'))
    expect(effect.slice(0, effect.indexOf('}, [pulsing'))).toContain('pulse.set(1)')
    expect(effect).toContain('cancelAnimation(pulse)')
  })

  it('never multiplies with the disabled dim', () => {
    // A pulse inside a 0.45 opacity is invisible; the two are alternatives.
    const block = atoms.slice(atoms.indexOf('export function IconButton'))
    expect(block).toContain("disabled === true ? { opacity: 0.45 } : pulseStyle")
  })
})
