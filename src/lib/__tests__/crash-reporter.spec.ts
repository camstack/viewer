/**
 * The wiring that turns a crash into evidence.
 *
 * Two rules carry the weight, and both were absent on 2026-08-20:
 *
 *  - the marker is claimed by a FATAL and by nothing else, so an ordinary
 *    handled error cannot make the next launch report a crash that never
 *    happened;
 *  - the previous marker is READ before this runtime arms its own, because
 *    arming overwrites the very thing being read — get that backwards and every
 *    launch forever reports `vanished`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { ExitMarkerRecorder, type ExitMarkerPort } from '../exit-marker.js'
import { parseExitMarker, classifyPreviousExit, isCrashExit } from '../crash-record.js'
import type { LogEntry } from '../logger.js'
import type { AppStateLike } from '../crash-reporter.js'

/** Let the recorder's fire-and-forget AsyncStorage write settle. */
const flushMicrotasks = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0))

interface FakeStorage {
  readonly port: ExitMarkerPort
  value: string | null
}

function fakeStorage(initial: string | null = null): FakeStorage {
  const state: FakeStorage = {
    value: initial,
    port: {
      read: (): Promise<string | null> => Promise.resolve(state.value),
      write: (value: string): Promise<void> => {
        state.value = value
        return Promise.resolve()
      },
    },
  }
  return state
}

/**
 * `vi.resetModules()` gives the reporter a FRESH `logger.js` — its own zustand
 * store. Reading the buffer through a statically imported logger therefore
 * inspects a different module instance and always sees nothing. Both are loaded
 * from the same graph here, per test.
 */
interface LoadedReporter {
  readonly installCrashReporter: (recorder: ExitMarkerRecorder) => boolean
  readonly reportPreviousExit: (recorder: ExitMarkerRecorder) => Promise<void>
  readonly bindExitMarkerToAppState: (
    appState: AppStateLike,
    recorder: ExitMarkerRecorder,
  ) => () => void
  readonly crashLines: () => readonly LogEntry[]
}

async function load(): Promise<LoadedReporter> {
  const logger = await import('../logger.js')
  const reporter = await import('../crash-reporter.js')
  return {
    installCrashReporter: reporter.installCrashReporter,
    reportPreviousExit: reporter.reportPreviousExit,
    bindExitMarkerToAppState: reporter.bindExitMarkerToAppState,
    crashLines: () => logger.useLogStore.getState().entries.filter((e) => e.scope === 'crash'),
  }
}

beforeEach(() => {
  vi.resetModules()
  Reflect.deleteProperty(globalThis, 'ErrorUtils')
})

describe('installCrashReporter', () => {
  it('records a fatal, and chains the handler it replaced', async () => {
    const handlers: ((error: unknown, isFatal?: boolean) => void)[] = []
    const previous = vi.fn()
    Reflect.set(globalThis, 'ErrorUtils', {
      getGlobalHandler: () => previous,
      setGlobalHandler: (h: (error: unknown, isFatal?: boolean) => void) => handlers.push(h),
    })
    const storage = fakeStorage()
    const { installCrashReporter, crashLines } = await load()

    expect(installCrashReporter(new ExitMarkerRecorder(storage.port))).toBe(true)
    const thrown = new TypeError('a.toSorted is not a function')
    handlers[0]?.(thrown, true)
    await vi.waitFor(() => expect(storage.value).not.toBeNull())

    const marker = parseExitMarker(storage.value)
    expect(marker?.kind).toBe('js-fatal')
    expect(marker?.message).toBe('TypeError: a.toSorted is not a function')
    // Chained, never replaced: swallowing a fatal turns a visible crash into a
    // frozen screen, which is harder to diagnose than the crash.
    expect(previous).toHaveBeenCalledWith(thrown, true)
    expect(crashLines().some((e) => e.level === 'error')).toBe(true)
  })

  it('does not let a NON-fatal claim the marker', async () => {
    const handlers: ((error: unknown, isFatal?: boolean) => void)[] = []
    Reflect.set(globalThis, 'ErrorUtils', {
      setGlobalHandler: (h: (error: unknown, isFatal?: boolean) => void) => handlers.push(h),
    })
    const storage = fakeStorage()
    const { installCrashReporter, crashLines } = await load()
    installCrashReporter(new ExitMarkerRecorder(storage.port))

    handlers[0]?.(new Error('recoverable'), false)
    await Promise.resolve()

    expect(storage.value).toBeNull()
    expect(crashLines().some((e) => e.level === 'warn')).toBe(true)
  })

  it('is a no-op where there is no ErrorUtils, instead of throwing', async () => {
    const { installCrashReporter } = await load()
    expect(installCrashReporter(new ExitMarkerRecorder(fakeStorage().port))).toBe(false)
  })

  it('installs once — a second install would chain us to ourselves', async () => {
    let count = 0
    Reflect.set(globalThis, 'ErrorUtils', {
      setGlobalHandler: () => {
        count += 1
      },
    })
    const { installCrashReporter } = await load()
    const recorder = new ExitMarkerRecorder(fakeStorage().port)
    installCrashReporter(recorder)
    installCrashReporter(recorder)
    expect(count).toBe(1)
  })
})

describe('reportPreviousExit', () => {
  it('names an OS kill: a marker still reading "running" is "vanished"', async () => {
    const storage = fakeStorage(JSON.stringify({ kind: 'running', at: 10 }))
    const { reportPreviousExit, crashLines } = await load()

    await reportPreviousExit(new ExitMarkerRecorder(storage.port))

    const line = crashLines()[0]
    expect(line?.msg).toBe('previous runtime exit: vanished')
    expect(line?.data).toMatchObject({ exit: 'vanished', crash: true })
  })

  it('accounts for a deliberate OTA reload without calling it a crash', async () => {
    const storage = fakeStorage(JSON.stringify({ kind: 'ota-reload', at: 10 }))
    const { reportPreviousExit, crashLines } = await load()

    await reportPreviousExit(new ExitMarkerRecorder(storage.port))

    expect(crashLines()[0]?.data).toMatchObject({ exit: 'ota-reload', crash: false })
  })

  it('READS before it ARMS — otherwise every launch reports vanished', async () => {
    const storage = fakeStorage(JSON.stringify({ kind: 'js-fatal', at: 10, message: 'boom' }))
    const { reportPreviousExit, crashLines } = await load()

    await reportPreviousExit(new ExitMarkerRecorder(storage.port))

    // The fatal was reported...
    expect(crashLines()[0]?.data).toMatchObject({ exit: 'js-fatal', message: 'boom' })
    // ...and only then was the marker re-armed for THIS runtime.
    expect(parseExitMarker(storage.value)?.kind).toBe('running')
  })
})

describe('the marker follows the app in and out of the foreground', () => {
  interface FakeAppState {
    currentState: string
    addEventListener: (t: 'change', h: (s: string) => void) => { remove: () => void }
    fire: (s: string) => void
  }

  function fakeAppState(initial: string): FakeAppState {
    const handlers: ((s: string) => void)[] = []
    return {
      currentState: initial,
      addEventListener: (_t, h) => {
        handlers.push(h)
        return { remove: () => handlers.splice(handlers.indexOf(h), 1) }
      },
      fire: (s) => handlers.forEach((h) => h(s)),
    }
  }

  it('closing the app writes backgrounded — the next launch must not call it a crash', async () => {
    const storage = fakeStorage()
    const app = fakeAppState('active')
    const { bindExitMarkerToAppState } = await load()
    bindExitMarkerToAppState(app, new ExitMarkerRecorder(storage.port))
    app.fire('background')
    await flushMicrotasks()

    // The verdict the operator sees on the NEXT launch. Asserted end-to-end
    // through the real classifier, because the bug lived in the gap between a
    // marker nobody wrote and a classifier that read the absence as a crash.
    const marker = await new ExitMarkerRecorder(storage.port).readPrevious()
    const exit = classifyPreviousExit(marker)
    expect(exit).toBe('backgrounded')
    expect(isCrashExit(exit)).toBe(false)
  })

  it('coming back to the foreground RE-ARMS — or a later kill would be excused', async () => {
    // The failure mode of a half-done fix: record on background, forget to
    // re-arm, and an app backgrounded once at 9am reports `backgrounded` for a
    // memory kill at 5pm with the phone in the operator's hand. That trades a
    // false crash for a MISSED one.
    const storage = fakeStorage()
    const app = fakeAppState('active')
    const { bindExitMarkerToAppState } = await load()
    bindExitMarkerToAppState(app, new ExitMarkerRecorder(storage.port))
    app.fire('background')
    await flushMicrotasks()
    app.fire('active')
    await flushMicrotasks()

    const marker = await new ExitMarkerRecorder(storage.port).readPrevious()
    expect(classifyPreviousExit(marker)).toBe('vanished')
  })

  it('iOS passes through `inactive` on the way out — the close still writes backgrounded', async () => {
    // The sequence iOS actually raises when the operator leaves the app is
    // active → inactive → background, never active → background. A binding
    // that only records from `active` wrote nothing on a real device, and
    // every ordinary close came back as `vanished` — six in four hours on
    // 1.0.442 (2026-09-05), three of them right after an "app background" line.
    const storage = fakeStorage()
    const app = fakeAppState('active')
    const { bindExitMarkerToAppState } = await load()
    bindExitMarkerToAppState(app, new ExitMarkerRecorder(storage.port))
    app.fire('inactive')
    await flushMicrotasks()
    app.fire('background')
    await flushMicrotasks()

    const marker = await new ExitMarkerRecorder(storage.port).readPrevious()
    expect(classifyPreviousExit(marker)).toBe('backgrounded')
  })

  it('`inactive` is not a close — a notification banner must not mask a crash', async () => {
    const storage = fakeStorage()
    const app = fakeAppState('active')
    const { bindExitMarkerToAppState } = await load()
    bindExitMarkerToAppState(app, new ExitMarkerRecorder(storage.port))
    app.fire('inactive')
    await flushMicrotasks()

    const marker = await new ExitMarkerRecorder(storage.port).readPrevious()
    // Nothing was written at all: the launch verdict is whatever it already was.
    expect(marker).toBeNull()
  })
})
