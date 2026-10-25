export const channel: string | null = null
export const runtimeVersion: string | null = null
export const updateId: string | null = null
export const isEmbeddedLaunch = true
export const isEnabled = false
export const createdAt: Date | null = null
export const checkForUpdateAsync = (): Promise<{ isAvailable: boolean }> =>
  Promise.resolve({ isAvailable: false })
export const fetchUpdateAsync = (): Promise<{ isNew: boolean }> => Promise.resolve({ isNew: false })
export const reloadAsync = (): Promise<void> => Promise.resolve()
export const useUpdates = (): { isUpdateAvailable: boolean; isUpdatePending: boolean } => ({
  isUpdateAvailable: false,
  isUpdatePending: false,
})
