/**
 * The ONE way to restart the JS runtime for an OTA update.
 *
 * Two sites used to call `Updates.reloadAsync()` directly (the launch gate and
 * Settings → Check for updates); both now go through here so that (1) the
 * exit marker is on disk before the runtime it describes is replaced
 * (`crash-record.ts`), and (2) in-flight native downloads are drained first
 * (`runtime-quiesce.ts`) — a download landing on a dead runtime was the
 * 1.0.454 (16) segfault.
 */
import * as Updates from 'expo-updates'
import { getExitMarkerRecorder } from './exit-marker.js'
import { log } from './logger.js'
import { runtimeQuiesce } from './runtime-quiesce.js'

/** Long enough for a tile download on a slow link; short enough that a stuck one does not hold the restart. */
export const RELOAD_DRAIN_TIMEOUT_MS = 4_000

export async function reloadRuntimeForUpdate(reason: string): Promise<void> {
  runtimeQuiesce.requestQuiesce()
  const inflight = runtimeQuiesce.inflight()
  const drained = await runtimeQuiesce.waitForIdle(RELOAD_DRAIN_TIMEOUT_MS)
  log.info('crash', 'restarting the runtime to apply an OTA update', { reason, inflight, drained })
  // Awaited, not fired off: the marker must be on disk before the runtime it
  // describes is replaced.
  await getExitMarkerRecorder().record('ota-reload')
  await Updates.reloadAsync()
}
