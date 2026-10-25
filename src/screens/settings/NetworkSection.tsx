/**
 * Settings → Advanced → Network: the LAN-first connection routes the app races,
 * which one is in use and why, a manual pin, a re-probe and a diagnosis.
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bug, Globe, Layers, Network, RefreshCcw, Wifi } from '../../lib/icons.js'
import { useServer } from '../../app/ServerProvider.js'
import { useConnection } from '../../connection/ConnectionProvider.js'
import {
  currentPageProtocol,
  isLoopbackUrl,
  pinnableRouteEndpoints,
} from '../../connection/endpoint-discovery.js'
import type { PinRouteOutcome } from '../../connection/system-controller.js'
import type { RouteDescription } from '../../connection/route-channel.js'
import { Section } from '../../components/ui/Section.js'
import { Row } from '../../components/ui/Row.js'
import { SelectRow } from '../../components/ui/SelectRow.js'
import { useNotice } from '../../components/ui/confirm.js'
import { runningVersionRows, versionValue } from './running-version.js'

/**
 * How often the section re-reads the route in use.
 *
 * A poll rather than a subscription because the route changes at most a handful
 * of times per session and only the controller knows when; adding a listener
 * API to `SystemController` for one read-only row would be more surface than
 * the row is worth. Two seconds is well inside "I opened Settings to look".
 */
const ROUTE_POLL_MS = 2000

export interface NetworkSectionProps {
  /**
   * Whether the operator can see this section right now: the Settings tab is
   * focused, the app is in the foreground AND the Advanced segment is the one
   * shown. Settings is a TAB, and tabs stay mounted (`freezeOnBlur: false`);
   * a hidden segment stays mounted too. Without the gate the 2 s poll — two
   * `setState`s, so a re-render — ran forever behind every other tab.
   */
  readonly active: boolean
}

export function NetworkSection({ active }: NetworkSectionProps) {
  const { t } = useTranslation()
  const notice = useNotice()
  const { endpoints, persistPinnedRouteUrl } = useServer()
  const { controller } = useConnection()
  const [reprobing, setReprobing] = useState(false)
  const [diagnosing, setDiagnosing] = useState(false)

  /**
   * The route ACTUALLY in use — not the configured hub URL.
   *
   * The two differ whenever the endpoint race pivots the transport, and the
   * operator has no other way to tell a LAN session from one running over the
   * public tunnel: on this deployment the same query costs 10-30 ms on the LAN
   * and 47-89 ms through the tunnel. Re-read when the section becomes visible
   * (the race settles behind the first frame) and after a manual re-probe.
   */
  const [route, setRoute] = useState<RouteDescription>(() => controller.getRoute())
  const [pinnedRouteUrl, setPinnedRouteUrl] = useState<string | null>(() => controller.getPinnedRouteUrl())
  useEffect(() => {
    if (!active) return
    setRoute(controller.getRoute())
    setPinnedRouteUrl(controller.getPinnedRouteUrl())
    const timer = setInterval(() => {
      setRoute(controller.getRoute())
      setPinnedRouteUrl(controller.getPinnedRouteUrl())
    }, ROUTE_POLL_MS)
    return () => clearInterval(timer)
  }, [controller, active])

  const routeEndpoints = pinnableRouteEndpoints(endpoints, currentPageProtocol())
  useEffect(() => {
    if (pinnedRouteUrl === null) return
    if (!isLoopbackUrl(pinnedRouteUrl)) return
    setPinnedRouteUrl(null)
    void persistPinnedRouteUrl(null)
    void controller.setPinnedRouteUrl(null).then(() => setRoute(controller.getRoute()))
  }, [pinnedRouteUrl, persistPinnedRouteUrl, controller])

  const handleReprobe = (): void => {
    if (reprobing || diagnosing) return
    setReprobing(true)
    void controller.reprobe().finally(() => {
      setReprobing(false)
      // The route is the POINT of a re-probe; re-read it so the row is not
      // still showing the pre-probe answer.
      setRoute(controller.getRoute())
    })
  }

  const handleDiagnoseNetwork = (): void => {
    if (diagnosing || reprobing) return
    setDiagnosing(true)
    const rows = runningVersionRows()
    void controller
      .diagnoseRoutes({
        app: versionValue(rows, 'app'),
        build: versionValue(rows, 'build'),
        runtime: versionValue(rows, 'runtime'),
        update: versionValue(rows, 'update'),
      })
      .then((results) => {
        const ok = results.filter((r) => r.ok).length
        notice({
          title: t('v2.settings.diagnoseNetwork'),
          message: t('v2.settings.diagnoseNetworkDone', {
            ok,
            total: results.length,
            fail: results.length - ok,
          }),
        })
      })
      .finally(() => {
        setDiagnosing(false)
      })
  }

  const handlePin = (v: string): void => {
    const next = v === '__auto__' ? null : v
    setPinnedRouteUrl(next)
    void controller.setPinnedRouteUrl(next).then((outcome: PinRouteOutcome) => {
      setRoute(controller.getRoute())
      if (outcome.kind === 'applied') {
        void persistPinnedRouteUrl(next)
        return
      }
      // Refused: show the pin that is really in force and say why, instead of
      // letting the 2 s poll flip the row back unexplained.
      setPinnedRouteUrl(controller.getPinnedRouteUrl())
      notice({
        title: t('v2.settings.preferredRoute'),
        message: t(
          outcome.reason === 'mixed-content'
            ? 'v2.settings.routePinRefusedMixed'
            : 'v2.settings.routePinRefusedIpv6',
          { url: next ?? '' },
        ),
      })
    })
  }

  const channelLabel: Record<RouteDescription['channel'], string> = {
    lan: t('v2.settings.routeChannelLan'),
    public: t('v2.settings.routeChannelPublic'),
    loopback: t('v2.settings.routeChannelLoopback'),
    unknown: t('v2.settings.routeChannelUnknown'),
  }
  const reasonLabel: Record<RouteDescription['reason'], string> = {
    initial: t('v2.settings.routeReasonInitial'),
    'race-won': t('v2.settings.routeReasonRaceWon'),
    'no-winner': t('v2.settings.routeReasonNoWinner'),
    unchanged: t('v2.settings.routeReasonUnchanged'),
    disposed: t('v2.settings.routeReasonDisposed'),
    pinned: t('v2.settings.routeReasonPinned'),
  }
  const pinned = pinnedRouteUrl !== null && !isLoopbackUrl(pinnedRouteUrl) ? pinnedRouteUrl : null

  return (
    <Section title={t('v2.settings.network')}>
      {/* WHICH route, and WHY that one. First row on purpose: it is the only
          line here that describes the present rather than the menu. */}
      <Row
        icon={route.channel === 'public' ? Globe : route.channel === 'lan' ? Wifi : Network}
        label={t('v2.settings.activeRoute')}
        value={`${channelLabel[route.channel]} · ${route.host} · ${reasonLabel[route.reason]}`}
      />
      <SelectRow
        icon={Layers}
        label={t('v2.settings.preferredRoute')}
        options={[
          { value: '__auto__', label: t('v2.settings.routeAuto') },
          ...routeEndpoints.map((e) => ({
            value: e.baseUrl,
            label: e.label,
            detail: e.plausible ? e.baseUrl : t('v2.settings.endpointUnlikely'),
          })),
          ...(pinned !== null && !routeEndpoints.some((e) => e.baseUrl === pinned)
            ? [{ value: pinned, label: pinned, detail: pinned }]
            : []),
        ]}
        value={pinned ?? '__auto__'}
        onChange={handlePin}
      />
      {routeEndpoints.length === 0 ? <Row icon={Network} label={t('v2.settings.networkNone')} /> : null}
      <Row
        icon={Bug}
        label={diagnosing ? t('v2.settings.diagnosingNetwork') : t('v2.settings.diagnoseNetwork')}
        onPress={handleDiagnoseNetwork}
      />
      <Row
        icon={RefreshCcw}
        label={reprobing ? t('v2.settings.reprobing') : t('v2.settings.reprobe')}
        onPress={handleReprobe}
        last
      />
    </Section>
  )
}
