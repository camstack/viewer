/** Mount harness stub: a device with no battery, so the host-battery hook reads "unavailable". */
export const BatteryState = { UNKNOWN: 0, UNPLUGGED: 1, CHARGING: 2, FULL: 3 } as const

export const isAvailableAsync = async (): Promise<boolean> => false
export const getBatteryLevelAsync = async (): Promise<number> => -1
export const getBatteryStateAsync = async (): Promise<number> => BatteryState.UNKNOWN

export const addBatteryLevelListener = (): { remove: () => void } => ({ remove: () => undefined })
export const addBatteryStateListener = (): { remove: () => void } => ({ remove: () => undefined })
