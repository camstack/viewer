import { create } from 'zustand'

/**
 * Transient, in-memory facts about this device's certificate that the UI
 * announces once: it was disconnected by the hub, an offer to keep the device
 * signed in is pending after a login, a hub refused self-enrollment.
 */
export interface DeviceNoticeState {
  /** The hub revoked this device (3 definitive answers): "This device was disconnected". */
  readonly disconnected: boolean
  /** A login just succeeded: offer "Keep this device signed in" once. */
  readonly enrollOfferPending: boolean
  /** Hub origins that answered `self-enrollment-disabled` this run: no button there. */
  readonly selfEnrollmentOff: readonly string[]
  setDisconnected: (value: boolean) => void
  setEnrollOfferPending: (value: boolean) => void
  markSelfEnrollmentOff: (origin: string) => void
}

export const useDeviceNotice = create<DeviceNoticeState>()((set) => ({
  disconnected: false,
  enrollOfferPending: false,
  selfEnrollmentOff: [],
  setDisconnected: (disconnected) => set({ disconnected }),
  setEnrollOfferPending: (enrollOfferPending) => set({ enrollOfferPending }),
  markSelfEnrollmentOff: (origin) =>
    set((state) => (state.selfEnrollmentOff.includes(origin) ? state : { selfEnrollmentOff: [...state.selfEnrollmentOff, origin] })),
}))
