import { recordOrientationCall } from '../orientation-control.js'

export const OrientationLock = {
  DEFAULT: 0,
  ALL: 1,
  PORTRAIT: 2,
  PORTRAIT_UP: 3,
  LANDSCAPE: 5,
  LANDSCAPE_LEFT: 6,
  LANDSCAPE_RIGHT: 7,
} as const
export const Orientation = { PORTRAIT_UP: 1, LANDSCAPE_LEFT: 3, LANDSCAPE_RIGHT: 4 } as const
let currentLock: number = OrientationLock.DEFAULT
/** Recorded, not just resolved — see `../orientation-control.ts`. */
export const lockAsync = (lock: number): Promise<void> => {
  recordOrientationCall({ kind: 'lock', lock })
  currentLock = lock
  return Promise.resolve()
}
export const unlockAsync = (): Promise<void> => {
  recordOrientationCall({ kind: 'unlock' })
  currentLock = OrientationLock.DEFAULT
  return Promise.resolve()
}
export const getOrientationAsync = (): Promise<number> => Promise.resolve(1)
/**
 * The lock the stub is currently holding, so a test can assert what the
 * theater REPORTS about it. Mirrors `lockAsync` / `unlockAsync` above rather
 * than resolving a constant: a stub that always says DEFAULT would make the
 * portrait-stack diagnostic untestable at the one value that matters.
 */
export const getOrientationLockAsync = (): Promise<number> => Promise.resolve(currentLock)
/** Test-only: set what `getOrientationLockAsync` will answer. */
export const __setStubLock = (lock: number): void => {
  currentLock = lock
}
export const addOrientationChangeListener = (): { remove: () => void } => ({
  remove: () => undefined,
})
export const removeOrientationChangeListener = (): void => undefined
