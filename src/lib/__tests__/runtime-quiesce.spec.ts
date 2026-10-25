import { describe, expect, it, vi } from 'vitest'
import { createRuntimeQuiesce } from '../runtime-quiesce.js'

/**
 * A runtime restart must not race a native download: `expo-file-system`
 * resolves its JS promise on the main thread when the download lands, and a
 * promise whose runtime has since been torn down is a segfault
 * (TestFlight 1.0.454 (16), 2026-09-06 17:39, `EXSessionTaskDispatcher …
 * didFinishDownloadingToURL → ~JavaScriptPromise`). So the reload first
 * closes the door to NEW work, then waits for the work in flight to land.
 */
describe('runtime quiesce — drain in-flight native work before a restart', () => {
  it('counts work in flight and admits new work until asked to quiesce', () => {
    const q = createRuntimeQuiesce()
    expect(q.admit()).toBe(true)
    const end = q.begin()
    expect(q.inflight()).toBe(1)
    end()
    end()
    expect(q.inflight()).toBe(0)
    q.requestQuiesce()
    expect(q.admit()).toBe(false)
  })

  it('waitForIdle resolves as soon as the last piece of work ends', async () => {
    const q = createRuntimeQuiesce()
    const end = q.begin()
    let settled = false
    const wait = q.waitForIdle(10_000).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    end()
    await wait
    expect(settled).toBe(true)
  })

  it('waitForIdle gives up at the bound — a stuck download must not hold the restart forever', async () => {
    vi.useFakeTimers()
    const q = createRuntimeQuiesce()
    q.begin()
    const wait = q.waitForIdle(500)
    vi.advanceTimersByTime(500)
    await expect(wait).resolves.toBe(false)
    vi.useRealTimers()
  })

  it('is immediate when nothing is in flight', async () => {
    const q = createRuntimeQuiesce()
    await expect(q.waitForIdle(1)).resolves.toBe(true)
  })
})
