import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LifecycleTracker } from '../lifecycle-trace.js'

/**
 * The tracker's job is to make a resume-time drop distinguishable from a flap.
 * `heldMs` is the number that does it, and repeats must stay silent or they
 * drown the signal.
 */
describe('LifecycleTracker', () => {
  it('reports how long the previous state was held', () => {
    let now = 1_000
    const t = new LifecycleTracker('connected', () => now)
    now = 3_600_000
    const rec = t.transition('disconnected')
    expect(rec).toEqual({ from: 'connected', to: 'disconnected', heldMs: 3_599_000 })
  })

  it('is silent when the state did not change', () => {
    // The SDK re-emits the same state; a line per repeat would bury the one
    // transition that matters.
    const t = new LifecycleTracker('connected', () => 0)
    expect(t.transition('connected')).toBeNull()
  })

  it('restarts the clock on each change', () => {
    let now = 0
    const t = new LifecycleTracker('connecting', () => now)
    now = 500
    t.transition('connected')
    now = 900
    expect(t.transition('disconnected')?.heldMs).toBe(400)
    expect(t.state).toBe('disconnected')
  })
})

describe('the connection layer is actually instrumented', () => {
  const read = (p: string): string =>
    readFileSync(join(process.cwd(), 'src', 'connection', p), 'utf8')

  it('state changes and endpoint races are traced', () => {
    const ctrl = read('system-controller.ts')
    expect(ctrl).toContain('traceConnection')
    // A race that starts and never finishes is one of the candidate faults, so
    // BOTH ends must be logged.
    expect(ctrl).toContain("traceRace('start'")
    expect(ctrl).toContain("traceRace('won'")
    expect(ctrl).toContain("traceRace('failed'")
    // Skipping the winner hid "health 200 then WS dies" — the LAN pin's
    // actual shape on TestFlight. Every probe, including the one that won,
    // has to land in the Settings log line.
    expect(ctrl).not.toContain('if (r.ok && r.url === winner) continue')
    expect(ctrl).toContain('diagnoseRoutes')
  })

  it('app foreground/background lands on the same timeline', () => {
    const tracer = read('AppPhaseTracer.tsx')
    expect(tracer).toContain('AppState.addEventListener')
    expect(tracer).toContain('traceAppPhase')
    // `awayMs` is what the operator's report hinges on — "riapro dopo un po'".
    expect(tracer).toContain('Date.now() - since')
  })

  it('ConnectionProvider stays free of react-native', () => {
    // It is imported transitively by every src/data/** hook and therefore by
    // their tests. Importing react-native from it makes 15 spec files fail to
    // LOAD (vitest runs in `node` and cannot parse RN's Flow syntax) — the
    // tests do not fail, they never run, which is quieter and worse. That is
    // why the AppState listener lives in AppPhaseTracer instead.
    const provider = read('ConnectionProvider.tsx')
    expect(provider).not.toContain("from 'react-native'")
    expect(provider).not.toContain('AppState')
  })

  it('asks on resume, and never redials blind', () => {
    // Three different faults produce the same "stuck on loading", so an
    // unconditional resume-triggered redial would destroy the evidence saying
    // which one it is. A bounded PROBE produces that evidence instead: it logs
    // whether the socket survived, and only a failed probe rebuilds anything.
    // Without it the app waits up to ~16 s for a keep-alive that was frozen
    // along with the rest of the process (see `resume-probe.ts`).
    //
    // The tracer now hands the return to `handleForeground`, which picks
    // between reopening a socket WE closed on the way into the background
    // (`background-suspend.ts`) and probing one we did not. The rule the guard
    // protects is unchanged: the tracer itself dials nothing, and the probe
    // branch is still the only thing a resume does to a socket it still holds.
    const tracer = read('AppPhaseTracer.tsx')
    expect(tracer).toContain('handleForeground')
    expect(tracer).not.toContain('controller.connect(')
    expect(tracer).not.toContain('.reconnect(')
    const ctrl = read('system-controller.ts')
    expect(ctrl).toContain('decideForegroundAction')
    expect(ctrl).toContain('verifyAfterResume')
  })
})
