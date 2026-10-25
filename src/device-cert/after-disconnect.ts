/**
 * After "Disconnect this device": never leave the app signed in with a dead session.
 *
 * Revoking the credential ends every session it minted. The app cannot tell
 * from its own state which kind it holds, so it asks the hub: renewing the
 * active session either works (it was opened another way — the password —
 * and stands) or is refused (it was the certificate's — the renewal path then
 * clears it and the auth gate shows the login screen).
 */
import type { RenewOutcome } from '../auth/refresh-session.js'

export interface AfterDisconnectInput {
  readonly renewSession: (reason: 'unauthorized') => Promise<RenewOutcome>
  /** Tell the login screen why the person is there. */
  readonly markDisconnected: () => void
}

export async function settleSessionAfterDisconnect(input: AfterDisconnectInput): Promise<'kept' | 'signed-out' | 'unknown'> {
  const renewal = await input.renewSession('unauthorized')
  if (renewal.status === 'refused') {
    input.markDisconnected()
    return 'signed-out'
  }
  return renewal.status === 'renewed' ? 'kept' : 'unknown'
}
