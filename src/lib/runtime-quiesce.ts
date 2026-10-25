/**
 * Drain in-flight native work before the JS runtime is restarted.
 *
 * `expo-file-system` settles a download's JS promise on the main thread when
 * the download lands. A promise whose runtime has since been torn down by
 * `Updates.reloadAsync()` is freed against a dead runtime — a segfault
 * (TestFlight 1.0.454 (16), 2026-09-06 17:39: the snapshot cache was
 * downloading 33 tiles while the launch OTA gate restarted the app). The
 * restart therefore (1) closes the door to new work, (2) waits for what is in
 * flight, bounded, (3) restarts. Work that would start after the door closed
 * simply does not — it is a cache that refills on the next runtime.
 */
export interface RuntimeQuiesce {
  /** May new native work start? False once a restart has been requested. */
  admit(): boolean
  /** Register a piece of work; call the returned function when it settles (idempotent). */
  begin(): () => void
  inflight(): number
  requestQuiesce(): void
  /** True when idle in time, false when the bound ran out. */
  waitForIdle(timeoutMs: number): Promise<boolean>
}

export function createRuntimeQuiesce(): RuntimeQuiesce {
  let count = 0
  let quiescing = false
  const waiters: (() => void)[] = []
  const notify = (): void => {
    if (count > 0) return
    const pending = waiters.splice(0)
    for (const w of pending) w()
  }
  return {
    admit: () => !quiescing,
    begin: () => {
      count += 1
      let ended = false
      return () => {
        if (ended) return
        ended = true
        count = Math.max(0, count - 1)
        notify()
      }
    },
    inflight: () => count,
    requestQuiesce: () => {
      quiescing = true
    },
    waitForIdle: (timeoutMs) => {
      if (count === 0) return Promise.resolve(true)
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs)
        waiters.push(() => {
          clearTimeout(timer)
          resolve(true)
        })
      })
    },
  }
}

/** The process-wide instance every native-work site and every restart share. */
export const runtimeQuiesce: RuntimeQuiesce = createRuntimeQuiesce()
