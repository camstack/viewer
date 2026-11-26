/**
 * How "Add a passkey" is offered, per platform.
 *
 * A passkey is bound to the hub's origin (the WebAuthn relying party). The
 * viewer does not run the ceremony itself: it opens the hub's own account page
 * (`/system/my-access`, admin-ui), where the enrolment flow already lives.
 *
 *  • Web — the viewer is served BY the hub, so the browser already holds the
 *    hub session cookie: the page opens signed in, in a new tab.
 *  • Native (D801) — the system browser holds no hub session. The hub mints a
 *    one-time handoff (`auth.createBrowserHandoff`) whose route opens that page
 *    signed in; it is opened at the CONFIGURED hub address, the one a passkey's
 *    relying party is most likely to be (a LAN IP is never one).
 */
import { useState } from 'react'
import { Linking, Platform } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { useServer } from '../../../app/ServerProvider.js'
import { useBrowserHandoff } from '../../../data/use-sign-in-methods.js'

/** The admin-ui route that enrols a passkey for the signed-in user. */
export const PASSKEY_ENROLMENT_PATH = '/system/my-access'

export interface PasskeyEnrolment {
  readonly open: () => void
  readonly opening: boolean
}

export function hubPageUrl(serverUrl: string, path: string): string {
  return `${serverUrl.replace(/\/+$/, '')}${path}`
}

export function usePasskeyEnrolment(onError: (message: string) => void): PasskeyEnrolment | null {
  const { server } = useServer()
  const handoff = useBrowserHandoff()
  const [opening, setOpening] = useState(false)
  if (server === null) return null
  const serverUrl = server.serverUrl

  const open = (): void => {
    setOpening(true)
    const run = async (): Promise<void> => {
      if (Platform.OS === 'web') {
        await Linking.openURL(hubPageUrl(serverUrl, PASSKEY_ENROLMENT_PATH))
        return
      }
      const path = await handoff.mutateAsync()
      await WebBrowser.openBrowserAsync(hubPageUrl(serverUrl, path))
    }
    run()
      .catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)))
      .finally(() => setOpening(false))
  }
  return { opening, open }
}
