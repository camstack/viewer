/**
 * use-rules-strip-key — the Rules tab's selected strip tab, remembered across
 * the Rules/Targets/Snooze segment (which unmounts the tab) for the SESSION.
 *
 * Ephemeral by operator decision (2026-10-21): which strip tab was open last
 * is not a setting at either level, so it lives in this module's memory and a
 * new launch opens on `all`.
 */
import { useCallback, useState } from 'react'
import type { NcRulesStripKey } from '../../components/notifications/rule-kind-nav.js'

export type RulesStripKeyState = readonly [NcRulesStripKey, (next: NcRulesStripKey) => void]

let sessionKey: NcRulesStripKey = 'all'

export function useRulesStripKey(): RulesStripKeyState {
  const [key, setKey] = useState<NcRulesStripKey>(sessionKey)
  const select = useCallback((next: NcRulesStripKey): void => {
    sessionKey = next
    setKey(next)
  }, [])
  return [key, select] as const
}

/** Test seam: a fresh session. */
export function resetRulesStripKeyForTests(): void {
  sessionKey = 'all'
}
