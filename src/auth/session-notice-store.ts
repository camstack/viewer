import { create } from 'zustand'

/**
 * Why the person is on the login screen when the hub ended their session
 * (revoked elsewhere, signed out everywhere): the server's name, shown once as
 * "You were signed out of <server>". In memory only; cleared by a sign-in.
 */
export interface SessionNoticeState {
  /** Display name of the server whose session the hub ended; `null` when none. */
  readonly endedServer: string | null
  setEnded: (serverName: string) => void
  clear: () => void
}

export const useSessionNotice = create<SessionNoticeState>()((set) => ({
  endedServer: null,
  setEnded: (endedServer) => set({ endedServer }),
  clear: () => set({ endedServer: null }),
}))
