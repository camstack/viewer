/**
 * `?hub=` on any deep link (`/camera/101?at=…&hub=https://…`) — the same
 * offer `/connect` makes, from inside the signed-in app.
 *
 * The link's own destination is honoured either way; the hub it names is only
 * ever a QUESTION. A saved, signed-in hub that is not active → "Switch?"; a
 * hub this device is not signed in to → "Add?" (the login, prefilled). The
 * active hub → nothing. Asked once per link: declining leaves the operator on
 * the current server and the same link never asks again this session.
 */
import { useEffect } from 'react'
import { router, type Href } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useServer } from '../app/ServerProvider.js'
import { useConfirm } from '../components/ui/confirm.js'
import { decideHubLink, hubParamOf, withoutHubParam } from '../connection/hub-link.js'
import { serverLabelForUrl, serverLabelOf } from '../connection/server-name.js'
import { deepLinkLanding } from './pending-deep-link.js'

/** The last link answered — module-level so a remount (a switch re-keys the
 *  whole connected subtree) does not ask the same question twice. */
let lastOfferedHref: string | null = null

/** Test seam. */
export function _resetHubParamOffer(): void {
  lastOfferedHref = null
}

export interface HubParamOfferProps {
  /** The current route's path plus its query string. */
  readonly href: string
  readonly params: Readonly<Record<string, string | string[] | undefined>>
}

export function HubParamOffer({ href, params }: HubParamOfferProps): null {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { servers, server, switchServer } = useServer()
  const hub = hubParamOf(params)

  useEffect(() => {
    if (hub === null || lastOfferedHref === href) return
    const decision = decideHubLink({ hub, servers, activeServerId: server?.id ?? null })
    if (decision.kind === 'invalid' || decision.kind === 'active') return
    lastOfferedHref = href
    const destination = withoutHubParam(href)
    const name = serverLabelForUrl(servers, decision.serverUrl)

    if (decision.kind === 'switch') {
      void confirm({
        title: t('v2.connect.switchTitle', { name }),
        message: server
          ? t('v2.connect.switchBody', { current: serverLabelOf(server) })
          : t('v2.connect.switchBodyNoCurrent'),
        confirmLabel: t('v2.connect.switch'),
        cancelLabel: t('v2.connect.stay'),
      }).then(async (ok) => {
        if (!ok) return
        const outcome = await switchServer(decision.serverId)
        // Documented type boundary: `deepLinkLanding` constrains the
        // destination to the app's route families.
        if (outcome.status === 'switched') router.replace(deepLinkLanding(destination) as Href)
      })
      return
    }

    void confirm({
      title: t('v2.connect.addTitle', { name }),
      message: t('v2.connect.addBody'),
      confirmLabel: t('v2.connect.continue'),
      cancelLabel: t('v2.connect.cancel'),
    }).then((ok) => {
      if (!ok) return
      router.push({ pathname: '/add-server', params: { url: decision.serverUrl, then: destination } })
    })
  }, [hub, href, servers, server, switchServer, confirm, t])

  return null
}
