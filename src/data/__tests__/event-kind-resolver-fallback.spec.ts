/**
 * The NATIVE label resolver must not answer with the raw class id.
 *
 * `useEventKindResolver` is what every native events surface calls, and its own
 * module header states the hole: *"a scoped set that omits a class makes its
 * label fall back to the raw English id"*. It shipped as
 * `return d ? eventKindLabel(d, t) : className` — so a camera whose `animal`
 * macro is off, a taxonomy batch still in flight (4190 ms over 16 cameras,
 * measured) or a failed query each printed `dog` to an Italian operator with
 * `Cane` sitting unused in `it.json`.
 *
 * The rule lives in `event-label-vocabulary` and is tested there against the
 * real locales. What THIS file guards is the wiring: the hook is built out of
 * react-query and the lucide set, so it cannot be mounted cheaply, and a rule
 * that is written and not called is the same defect with more code. The
 * assertions are therefore over the source of the one function that must use
 * it — the pattern this repo already uses for wiring that a renderer cannot
 * reach.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(
  fileURLToPath(new URL('../use-event-kind-resolver.ts', import.meta.url)),
  'utf8',
)

/** The RETURNED resolver object — not the interface that declares its shape. */
const IMPLEMENTATION = SOURCE.slice(SOURCE.indexOf('return useMemo<EventKindResolver>'))

/** The body of one arrow property of the returned resolver. */
function bodyOf(name: string): string {
  const from = IMPLEMENTATION.indexOf(`${name}: (`)
  expect(from, `${name} not found`).toBeGreaterThan(-1)
  const next = IMPLEMENTATION.indexOf('\n      resolve', from + 1)
  return IMPLEMENTATION.slice(from, next === -1 ? IMPLEMENTATION.length : next)
}

describe('useEventKindResolver label fallbacks', () => {
  it('resolves a class through the catalog rule, not the raw id', () => {
    const body = bodyOf('resolveLabel')
    expect(body).toContain('resolveEventLabelText')
    // The exact expression that shipped the defect.
    expect(body).not.toMatch(/:\s*className\s*$/m)
  })

  it('resolves an audio label through the catalog rule, not the raw label', () => {
    const body = bodyOf('resolveAudioLabel')
    expect(body).toContain('resolveAudioLabelText')
    expect(body).not.toMatch(/:\s*label\s*$/m)
  })

  it('imports the rule from the one module that owns it', () => {
    expect(SOURCE).toContain("from './event-label-vocabulary.js'")
  })
})
