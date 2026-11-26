/**
 * How "Link <provider>" runs, per platform.
 *
 *  • Web — the SSO popup (`auth/web-link-popup.ts`). The blank popup is opened
 *    INSIDE the press, before the start URL is fetched: opened after an await
 *    it is what a popup blocker blocks. Blocked → the page itself navigates
 *    (the full-page return lands on the hub's account page).
 *  • Native (D801) — the system browser in an auth session, started with
 *    `returnTo` = the app's callback. The hub parks the verified identity and
 *    returns `?link=<code>`, which this app claims with its own session. The
 *    start URL resolves against the address the app is CONNECTED through, LAN
 *    or public: the IdP returns to the origin the flow started at (D794), and
 *    the hub returns to the app's scheme from either.
 */
import { useState } from 'react'
import { Platform } from 'react-native'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { useServer } from '../../../app/ServerProvider.js'
import { useConnection } from '../../../connection/ConnectionProvider.js'
import { canonicalizeCallbackUrl, HANDOFF_CALLBACK_PATH } from '../../../auth/handoff.js'
import { useBeginLink, useClaimLink } from '../../../data/use-sign-in-methods.js'
import { parseLinkCallback } from '../../../data/sign-in-methods.js'
import { openLinkPopup, runLinkPopup, type LinkOutcome } from '../../../auth/web-link-popup.js'

export interface LinkFlow {
  /** The provider being linked right now, or `null`. */
  readonly pending: string | null
  /** `reauthToken` — the "Confirm it's you" proof (D813); `null` on a hub
   *  that asks for none. */
  readonly start: (provider: string, reauthToken: string | null) => Promise<LinkOutcome>
}

/** A claim outcome in the popup's vocabulary, so one reporter serves both. */
function claimToOutcome(outcome: 'linked' | 'conflict' | 'expired' | 'session'): LinkOutcome {
  return outcome === 'linked' ? { kind: 'linked' } : { kind: 'error', reason: outcome }
}

export function useLinkFlow(): LinkFlow | null {
  const { server } = useServer()
  const { controller } = useConnection()
  const begin = useBeginLink()
  const claim = useClaimLink()
  const [pending, setPending] = useState<string | null>(null)
  if (server === null) return null

  const startWeb = async (provider: string, reauthToken: string | null): Promise<LinkOutcome> => {
    const hubUrl = server.serverUrl
    // Opened after the re-authentication, so a blocker may stop it: blocked →
    // the full-page flow below, as admin-ui does.
    const popup = openLinkPopup()
    try {
      const url = await begin.mutateAsync({ provider, reauthToken })
      if (popup === null) {
        window.location.assign(new URL(url, hubUrl).toString())
        return { kind: 'closed' }
      }
      return await runLinkPopup(popup, url, hubUrl)
    } catch (err: unknown) {
      popup?.close()
      throw err
    }
  }

  const startNative = async (provider: string, reauthToken: string | null): Promise<LinkOutcome> => {
    const hubUrl = controller.getSystem()?.serverUrl ?? server.serverUrl
    const callbackUrl = canonicalizeCallbackUrl(Linking.createURL(HANDOFF_CALLBACK_PATH))
    const url = await begin.mutateAsync({ provider, returnTo: callbackUrl, reauthToken })
    const result = await WebBrowser.openAuthSessionAsync(new URL(url, hubUrl).toString(), callbackUrl)
    if (result.type !== 'success') return { kind: 'closed' }
    const back = parseLinkCallback(result.url)
    if (back === null) return { kind: 'closed' }
    if ('error' in back) return { kind: 'error', reason: back.error }
    return claimToOutcome(await claim.mutateAsync(back.code))
  }

  return {
    pending,
    start: async (provider, reauthToken) => {
      setPending(provider)
      try {
        return await (Platform.OS === 'web' ? startWeb(provider, reauthToken) : startNative(provider, reauthToken))
      } finally {
        setPending(null)
      }
    },
  }
}
