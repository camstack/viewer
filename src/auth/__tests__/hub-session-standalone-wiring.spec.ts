import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The standalone gate is WIRED, not just defined.
 *
 * `shouldBounceToHubLogin` (see `hub-session-exchange.spec.ts`) is pure; this
 * file pins the two reads that feed it and the branch that obeys it, because
 * vitest runs `node` here and cannot mount `HubSessionBootstrap`:
 *
 *   - `readStandalone()` asks BOTH signals: `matchMedia('(display-mode:
 *     standalone)')` (the standard, Android Chrome and iOS 16.4+) and
 *     `navigator.standalone` (iOS, every version). Either alone misses a
 *     platform.
 *   - the `unauthorized` branch consults the gate before `location.assign`.
 *   - `canReuseHubSession` carries the reading into `HubWebBootEnv`, so the
 *     env the boot gate builds says what the bootstrap will do.
 */

const SRC = join(process.cwd(), 'src')
const bootstrap = readFileSync(join(SRC, 'auth', 'HubSessionBootstrap.tsx'), 'utf8')

describe('HubSessionBootstrap — standalone never bounces to the hub login', () => {
  it('reads both standalone signals', () => {
    const start = bootstrap.indexOf('export function readStandalone')
    expect(start).toBeGreaterThan(-1)
    const body = bootstrap.slice(start, bootstrap.indexOf('\n}', start))
    expect(body).toContain("'(display-mode: standalone)'")
    expect(body).toContain('navigator')
    expect(body).toContain('standalone === true')
  })

  it('consults the gate on the unauthorized branch, before the redirect', () => {
    const branch = bootstrap.indexOf("outcome.status === 'unauthorized'")
    const gate = bootstrap.indexOf('shouldBounceToHubLogin(', branch)
    const assign = bootstrap.indexOf('window.location.assign(', branch)
    expect(branch).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(branch)
    expect(assign).toBeGreaterThan(gate)
  })

  it('the boot env carries the reading', () => {
    expect(bootstrap).toMatch(/standalone: readStandalone\(\)/)
  })
})
