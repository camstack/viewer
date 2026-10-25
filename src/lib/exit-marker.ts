/**
 * exit-marker — the one place the "why did the previous runtime stop?" marker
 * is written to and read from the device.
 *
 * Read `crash-record.ts` first: it owns every rule, all pure and unit-tested.
 * This file is the effects, behind a narrow port so the sequencing can be
 * tested against an in-memory fake instead of a simulator.
 *
 * ## Storage, and why a failure here is silent
 *
 * `AsyncStorage`: the payload is one small JSON string, it must survive the
 * process being killed, and every other small persisted fact in this app
 * already lives there (`app/kv-async-storage.ts`, `connection/server-store.ts`).
 *
 * Every method swallows its own storage failure. This module is diagnostics: a
 * reporter that can take the app down while explaining why the app went down
 * is worse than no reporter. The cost of a swallowed write is one launch
 * classified `vanished` — which is the answer that asks a human to look, not
 * one that hides anything.
 *
 * ## Ordering
 *
 * `readPrevious()` must happen BEFORE `arm()`, once, at launch — arming
 * overwrites the very marker being read. `reportPreviousExit` in
 * `crash-reporter.ts` is the only caller and does both in that order.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  parseExitMarker,
  serializeExitMarker,
  type ExitKind,
  type ExitMarker,
  type ThrownDescription,
} from './crash-record.js'

/** Everything the recorder needs from storage, and nothing more. */
export interface ExitMarkerPort {
  read: () => Promise<string | null>
  write: (value: string) => Promise<void>
}

export const EXIT_MARKER_STORAGE_KEY = 'camstack.runtime.exit-marker.v1'

/** Bind the port to AsyncStorage. */
export function createExitMarkerPort(): ExitMarkerPort {
  return {
    read: (): Promise<string | null> => AsyncStorage.getItem(EXIT_MARKER_STORAGE_KEY),
    write: (value: string): Promise<void> =>
      AsyncStorage.setItem(EXIT_MARKER_STORAGE_KEY, value),
  }
}

export class ExitMarkerRecorder {
  constructor(
    private readonly port: ExitMarkerPort,
    private readonly now: () => number = Date.now,
  ) {}

  /** The marker the PREVIOUS runtime left, or null when there is none. */
  readPrevious = async (): Promise<ExitMarker | null> => {
    try {
      return parseExitMarker(await this.port.read())
    } catch {
      return null
    }
  }

  /** Claim the marker for this runtime. Anything that stops us before the next
   *  `record` now reads as `vanished`. */
  arm = (): Promise<void> => this.record('running')

  /**
   * State how this runtime is ending.
   *
   * Best-effort by necessity: on a fatal, the native side is already tearing
   * the process down and this write is racing it. It usually wins — the handler
   * runs synchronously and the teardown is posted to the main queue — and when
   * it loses, the marker still says `running` and the next launch reports
   * `vanished`, which is not a wrong answer, only a less specific one.
   */
  record = async (kind: ExitKind, description?: ThrownDescription): Promise<void> => {
    const marker: ExitMarker = {
      kind,
      at: this.now(),
      message: description?.message,
      stack: description?.stack ?? undefined,
    }
    try {
      await this.port.write(serializeExitMarker(marker))
    } catch {
      // See the docblock: diagnostics never take the app down.
    }
  }
}

/** `undefined` = not built yet. One recorder per process — two would race each
 *  other for the same key and the loser would erase a fatal. */
let instance: ExitMarkerRecorder | undefined

export function getExitMarkerRecorder(): ExitMarkerRecorder {
  instance ??= new ExitMarkerRecorder(createExitMarkerPort())
  return instance
}
