/**
 * NodeApp — one node's own UI (the agent UI on port 4444) inside the viewer.
 *
 * Local network only: the node's address is one of its LAN addresses. Off the
 * LAN the screen says so and points at the Admin's Nodes page, which is the way
 * to reach a node from anywhere. On a phone the unlock ticket is minted by the
 * hub, redeemed by THIS app (`POST /api/agent/session`) and the resulting tab
 * session is injected before the page loads — nothing secret is in a URL. On the
 * web a new tab is opened, as the Admin's Nodes page does.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Platform, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { ConnectingIndicator } from '../components/ui/ConnectingIndicator.js'
import { EmptyState } from '../components/ui/EmptyState.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { isLocalRouteChannel } from '../connection/route-channel.js'
import { useLiveHubUrl } from '../connection/use-live-hub-url.js'
import { useRouteChannel } from '../connection/use-route-channel.js'
import { capMutateOrThrow, isCapClient, capQuery } from '../data/cap-query.js'
import { useTheme } from '../theme/theme-provider.js'
import { adminRootUrl } from './admin-frame.js'
import { AppFrame } from './AppFrame.js'
import { AppTopStrip } from './AppTopStrip.js'
import { useAppStore } from './app-store.js'
import {
  ADMIN_NODES_PATH,
  agentBaseUrl,
  nodeOpenBlock,
  parseSessionToken,
  parseTicket,
  pickAgentHost,
  sessionInjection,
} from './node-agent.js'

/** `nodes.topology` walks the whole cluster (tens of seconds): give it room. */
const TOPOLOGY_DEADLINE_MS = 60_000

type State =
  | { readonly status: 'working' }
  | { readonly status: 'frame'; readonly uri: string; readonly injection: string }
  | { readonly status: 'tab-opened' }
  | { readonly status: 'off-lan' }
  | { readonly status: 'no-address' }
  | { readonly status: 'failed' }

interface TopologyLike {
  readonly id: string
  readonly localIps: readonly string[]
}

function topologyNodes(raw: unknown): readonly TopologyLike[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((row: unknown) => {
    if (typeof row !== 'object' || row === null) return []
    const id: unknown = Reflect.get(row, 'id')
    const ips: unknown = Reflect.get(row, 'localIps')
    if (typeof id !== 'string') return []
    return [{ id, localIps: Array.isArray(ips) ? ips.filter((ip): ip is string => typeof ip === 'string') : [] }]
  })
}

export interface NodeAppProps {
  readonly nodeId: string
  readonly nodeName: string
}

export function NodeApp({ nodeId, nodeName }: NodeAppProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { controller } = useConnection()
  const liveBase = useLiveHubUrl()
  const local = isLocalRouteChannel(useRouteChannel())
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen)
  const [state, setState] = useState<State>({ status: 'working' })
  const [reloadKey, setReloadKey] = useState(0)
  const run = useRef(0)

  const open = useCallback(async (): Promise<void> => {
    const mine = ++run.current
    const settle = (next: State): void => {
      if (mine === run.current) setState(next)
    }
    settle({ status: 'working' })
    if (!local) {
      settle({ status: 'off-lan' })
      return
    }
    try {
      const system = controller.getSystem()
      if (system === null) throw new Error('not connected')
      const client: unknown = system.trpcClient
      if (!isCapClient(client)) throw new Error('not connected')
      const topology = topologyNodes(
        await capQuery(client, 'nodes', 'topology', undefined, { rethrow: true, deadlineMs: TOPOLOGY_DEADLINE_MS }),
      )
      const host = pickAgentHost(topology.find((n) => n.id === nodeId)?.localIps ?? [])
      const block = nodeOpenBlock(local, host)
      if (block !== null || host === null) {
        settle({ status: block ?? 'no-address' })
        return
      }
      const base = agentBaseUrl(host)
      const ticket = parseTicket(
        await capMutateOrThrow(client, 'addons', 'custom', {
          addonId: 'system-config',
          action: 'mintAgentUiUnlockTicket',
          input: { nodeId, dashboardBaseUrl: base },
        }),
      )
      if (ticket === null) throw new Error('no ticket')
      if (Platform.OS === 'web') {
        const tab = `${base}?ticket=${encodeURIComponent(ticket)}`
        await Linking.openURL(tab)
        settle({ status: 'tab-opened' })
        return
      }
      const response = await fetch(`${base}api/agent/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticket }),
      })
      if (!response.ok) throw new Error(`session HTTP ${response.status}`)
      const token = parseSessionToken(await response.json())
      if (token === null) throw new Error('no session token')
      settle({ status: 'frame', uri: base, injection: sessionInjection(token) })
    } catch {
      settle({ status: 'failed' })
    }
  }, [controller, local, nodeId])

  useEffect(() => {
    void open()
  }, [open])

  const adminNodes = liveBase === null ? null : `${adminRootUrl(liveBase).replace(/\/$/, '')}${ADMIN_NODES_PATH}`

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]} testID="node-app">
      <AppTopStrip
        title={nodeName}
        local={local}
        onMenu={() => setDrawerOpen(true)}
        onReload={() => {
          setReloadKey((k) => k + 1)
          void open()
        }}
      />
      <View style={styles.fill}>
        {state.status === 'working' ? (
          <ConnectingIndicator visible label={t('v2.apps.nodeOpening')} dotColor={colors.primary} />
        ) : state.status === 'frame' ? (
          <AppFrame uri={state.uri} reloadKey={reloadKey} injectedBefore={state.injection} testID="node-frame" />
        ) : state.status === 'tab-opened' ? (
          <EmptyState title={t('v2.apps.nodeTabOpened')} />
        ) : state.status === 'off-lan' ? (
          <EmptyState
            title={t('v2.apps.nodeLocalOnly')}
            body={t('v2.apps.nodeLocalOnlyBody')}
            action={adminNodes === null ? undefined : { label: t('v2.apps.openAdminNodes'), onPress: () => void Linking.openURL(adminNodes) }}
          />
        ) : state.status === 'no-address' ? (
          <EmptyState
            title={t('v2.apps.nodeNoAddress')}
            body={t('v2.apps.nodeNoAddressBody')}
            action={adminNodes === null ? undefined : { label: t('v2.apps.openAdminNodes'), onPress: () => void Linking.openURL(adminNodes) }}
          />
        ) : (
          <EmptyState
            tone="danger"
            title={t('v2.apps.nodeFailed')}
            action={{ label: t('v2.apps.reload'), onPress: () => void open() }}
          />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
