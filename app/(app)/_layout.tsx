// Authenticated app group. A parent Stack (headerShown:false) that holds the
// bottom-tab navigator plus the stacked detail routes (camera/[id], grid/[id],
// grid/[id]/edit) so they PUSH OVER the tabs instead of being swapped by the
// headless Tabs <TabSlot>. The single ConnectionProvider lives here so every
// screen in the group — tabs AND detail — shares one connection. Auth guard is
// lifted here from the old tabs layout: no active server/token → back to login.
import { AccountSyncBridge } from "../../src/account/AccountSyncBridge";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Redirect, Stack, useGlobalSearchParams, usePathname } from "expo-router";
import { useServer } from "../../src/app/ServerProvider";
import { stashPendingDeepLink } from "../../src/navigation/pending-deep-link";
import { HubParamOffer } from "../../src/navigation/HubParamOffer";
import { ConnectionProvider } from "../../src/connection/ConnectionProvider";
import { HubConnectionOverlay } from "../../src/components/HubConnectionOverlay";
import { AppPhaseTracer } from "../../src/connection/AppPhaseTracer";
import { useLiveInvalidation } from '../../src/data/use-live-invalidation';
import { useResumeReconcile } from '../../src/data/use-resume-reconcile';
import { useCameras } from '../../src/data/use-cameras';
import { SnapshotOverviewProvider } from '../../src/data/SnapshotOverviewProvider';
import { useAppForeground } from '../../src/hooks/use-screen-active';
import {
  LastCameraWatcher,
  ReopenLastCameraBridge,
} from '../../src/navigation/LastCameraBridge';
import { OnDemandPlayerHost } from '../../src/components/camera/OnDemandPlayerHost';
import { DeviceEnrollmentProvider } from '../../src/device-cert/DeviceEnrollmentProvider';
import { useActivityHost } from '../../src/activity/use-activity-host';

/**
 * Renders nothing; it exists so the hub's device events drive the query cache
 * instead of every hook polling for the same news. Must sit INSIDE
 * `ConnectionProvider` (it needs the live connection) and outside the screens
 * (it must be mounted exactly once).
 */
function LiveInvalidationBridge(): null {
  useLiveInvalidation()
  return null
}

/**
 * The Activity centre's list, kept true to the hub: binds the store to the
 * active server, reconciles its exports and re-asks on resume. Mounted once.
 */
function ActivityHostBridge(): null {
  useActivityHost()
  return null
}

/**
 * The other half of the same job: events only reach a client that is AWAKE and
 * connected. A suspended app hears nothing, so on resume — and on every
 * transport recovery — the volatile device state is re-asked once instead of
 * waiting up to five minutes for the reconcile poll. See
 * `src/data/resume-reconcile.ts` for what it touches and why.
 */
function ResumeReconcileBridge(): null {
  useResumeReconcile()
  return null
}

/**
 * One snapshot-freshness poll for the whole authenticated app.
 *
 * Mounted here rather than per-screen because snapshots render in seven places
 * across different route subtrees, and a surface with no frame identity gets a
 * permanently stable URL — which, since `expo-image` never revalidates, is a
 * thumbnail frozen until its disk-cache entry is evicted. One place to mount,
 * one small RPC, every surface covered.
 */
function SnapshotOverviewBridge({ children }: { children: React.ReactNode }) {
  const { data: cameras } = useCameras({ includeHidden: true })
  const foreground = useAppForeground()
  const deviceIds = useMemo(() => (cameras ?? []).map((c) => c.id), [cameras])
  return (
    <SnapshotOverviewProvider
      deviceIds={deviceIds}
      enabled={deviceIds.length > 0 && foreground}
    >
      {children}
    </SnapshotOverviewProvider>
  )
}

export default function AppLayout() {
  const {
    server,
    token,
    sessionToken,
    initialCandidates,
    initialPinnedRouteUrl,
    onEndpointsDiscovered,
    renewSession,
    attachSystem,
  } = useServer();
  const serverUrl = server?.serverUrl;

  // Seed the race with the last session's cached hub endpoints (LAN-first) plus
  // the configured URL; fall back to just the configured URL on a first launch.
  // MEMOISED so re-probing (which updates `endpoints` but NOT `initialCandidates`
  // / `onEndpointsDiscovered`) does not rebuild the config → does not tear down
  // the transport. The live controller grows its own candidate set internally.
  // Seeded with the SESSION token, not the live one: an hourly renewal (D812)
  // swaps the token on the live System in place and must not redial.
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const config = useMemo(
    () =>
      serverUrl
        ? {
            serverUrl,
            token: sessionToken ?? undefined,
            candidates:
              initialCandidates.length > 0 ? [...initialCandidates] : [serverUrl],
            pinnedRouteUrl: initialPinnedRouteUrl,
            onEndpointsDiscovered,
          }
        : null,
    [serverUrl, sessionToken, initialCandidates, initialPinnedRouteUrl, onEndpointsDiscovered],
  );

  if (!server || !token || !config) {
    // Preserve the URL this cold start was OPENING (a notification tap, a
    // Universal Link) across the auth gate — the index consumes it after
    // login instead of defaulting to /cameras. Stashed during render on
    // purpose: this subtree unmounts with the Redirect, there is no later
    // lifecycle moment. See src/navigation/pending-deep-link.ts.
    stashPendingDeepLink(`${pathname}${searchQueryString(params)}`);
    return <Redirect href="/" />;
  }

  // KEYED by server: a switch to another saved hub unmounts the whole
  // connected subtree — the controller and its WebSocket, every live player,
  // every bridge — and mounts it fresh against the new hub. The query cache was
  // emptied before the switch took effect (src/connection/server-switch.ts).
  return (
    <ConnectionProvider
      key={server.id}
      config={config}
      onUnauthorized={() => void renewSession('unauthorized')}
      attachSystem={attachSystem}
    >
      <AppPhaseTracer />
      <HubParamOffer href={`${pathname}${searchQueryString(params)}`} params={params} />
      <LiveInvalidationBridge />
      <ResumeReconcileBridge />
      <ActivityHostBridge />
      {/* "Reopen the last camera": one bridge maintains the memory as the
          operator navigates, the other spends it once at launch. Mounted here
          because both must exist exactly once and the reopen needs the camera
          list — it refuses a camera that is gone or disabled. See
          `src/navigation/last-camera.ts`. */}
      <LastCameraWatcher />
      <ReopenLastCameraBridge />
      {/* Account settings (per user, per hub): local changes go to the hub
          from wherever they were made, other devices' changes arrive on
          resume and every minute in the foreground. */}
      <AccountSyncBridge />
      <DeviceEnrollmentProvider>
      <SnapshotOverviewBridge>
        {/* The navigator and the on-demand player share a positioned parent so
            the overlay can be absolutely placed over whatever route is
            mounted. One extra View above the <Stack>, which re-parents no
            screen — the thing that matters, since re-parenting a route is what
            remounts the WebRTC sessions inside it. */}
        <View style={styles.navigatorRoot}>
          <Stack
            screenOptions={{
              headerShown: false,
              // The stacked routes are presented OVER the tabs (contained
              // transparent), so the tab screen underneath stays visible.
              // react-native-screens freezes a blurred screen by default, which
              // showed the camera list alive and stale behind them.
              freezeOnBlur: false,
            }}
          />
          {/* AFTER the navigator, so paint order puts it over every route —
              including the stacked ones, which are presented over the tabs.
              `OnDemandPlayerHost` is `pointerEvents="box-none"`, so the routes
              underneath keep receiving every touch the panel does not take.

              Unaffected by `freezeOnBlur` above: that option governs SCREENS,
              and this is not one — it is a sibling of the navigator, so no
              screen lifecycle reaches it and it cannot be frozen behind a
              stacked route. That is the same property that makes it survive
              navigation at all. */}
          <OnDemandPlayerHost />
          {/* THE hub-connection status, once for the whole app and over
              every route (after the player host in paint order). Screens
              keep their content and never render a connection state of their
              own — see src/components/HubConnectionOverlay.tsx. */}
          <HubConnectionOverlay />
        </View>
      </SnapshotOverviewBridge>
      </DeviceEnrollmentProvider>
    </ConnectionProvider>
  );
}

/** Rebuild the query string a deep link carried; empty when none. */
function searchQueryString(params: Record<string, string | string[]>): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

const styles = StyleSheet.create({
  /** Fills the group so the overlay has a box to be absolutely placed in. */
  navigatorRoot: { flex: 1 },
});
