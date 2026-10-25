import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { navigationCapability, networkLinkCapability, expandCapMethods } from '@camstack/types'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * `scripts/check-cap-query-names.mjs` validates every literal
 * `(capability, method)` pair against `@camstack/types`. Its first version
 * compared them against `def.methods` ALONE, which is not the surface the hub
 * mounts: `expandCapMethods` injects `getStatus` for every cap carrying a
 * `status` block (and the settings-contribution trio for
 * `exposesDeviceSettings`), and `scripts/generate-cap-routers.ts` emits exactly
 * that expansion. So two live, working calls — `networkLink.getStatus` and
 * `navigation.getStatus` — were reported as unresolvable and parked in
 * `KNOWN_BROKEN`.
 *
 * A guard that names a working call broken is worse than no guard: the next
 * session deletes the call.
 */
describe('cap-query name guard', () => {
  it('counts an auto-injected getStatus as part of a cap surface', () => {
    // `methods: {}` — network-link's whole surface IS the injected getStatus.
    expect(Object.keys(networkLinkCapability.methods)).toEqual([])
    expect(Object.keys(expandCapMethods(networkLinkCapability))).toContain('getStatus')
    expect(Object.keys(navigationCapability.methods)).not.toContain('getStatus')
    expect(Object.keys(expandCapMethods(navigationCapability))).toContain('getStatus')
  })

  it('passes with nothing parked as known-broken', () => {
    const out = execFileSync('node', ['scripts/check-cap-query-names.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    expect(out).toContain('all resolve')
    // An entry parked in KNOWN_BROKEN is a call this app makes forever and is
    // answered `null` forever. There are none left; a new one must be fixed,
    // not listed.
    expect(out).not.toContain('KNOWN BROKEN')
    // A tripwire on COVERAGE, not on a number: the guard watches the write
    // helpers (`capMutate`, `capMutateOrThrow`) as well as `capQuery`, and
    // narrowing its regex back to reads alone would drop 13 call sites while
    // still printing "all resolve". Counted 75 on 2026-09-24.
    const count = Number(/capQuery names: (\d+) literal/.exec(out)?.[1])
    expect(count).toBeGreaterThanOrEqual(70)
  })
})
