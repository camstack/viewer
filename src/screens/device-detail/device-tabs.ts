/**
 * The device detail's tabs. `transitions` (the command audit log of the device)
 * is built as a tab but not offered until its data source exists; flip
 * {@link TRANSITIONS_READY} then, nothing else changes.
 */
export type DeviceTabId = 'overview' | 'history' | 'transitions'

export const TRANSITIONS_READY = false

export function deviceTabs(transitionsReady: boolean = TRANSITIONS_READY): readonly DeviceTabId[] {
  return transitionsReady ? ['overview', 'history', 'transitions'] : ['overview', 'history']
}
