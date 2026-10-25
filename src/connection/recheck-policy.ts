/** The connection states the SDK emits. Mirrors `@camstack/sdk`'s
 *  `BackendConnectionState` exactly ('connecting' | 'connected' | 'disconnected');
 *  kept structural so this module has no SDK import. A reconnect cycle surfaces
 *  as connected → disconnected → connecting → connected. */
export type ConnState = 'connecting' | 'connected' | 'disconnected'

/** After `switchServerUrl`, tRPC's previous WebSocket `onClose` is async — it
 *  lands hundreds of milliseconds after the replacement socket is already
 *  `connected`. Observed on TestFlight 1.0.375: 318ms. Bound generously so a
 *  slow TLS teardown of the public tunnel is not mistaken for a LAN drop. */
export const STALE_SWITCH_CLOSE_MS = 2_000

/** Re-evaluate the fastest endpoint (LAN vs remote) only when we have just
 *  (re)gained a connection — that is the moment the best route may have
 *  changed (network switch, VPN up, came back on LAN). Never while offline. */
export function shouldRerace(prev: ConnState, next: ConnState): boolean {
  return next === 'connected' && prev !== 'connected'
}

/** True when `disconnected` is the previous socket closing after a successful
 *  switch, not a drop of the socket we just opened. */
export function isStaleSwitchClose(
  selfSwitchConnectedAtMs: number | null,
  nowMs: number,
  windowMs: number = STALE_SWITCH_CLOSE_MS,
): boolean {
  return selfSwitchConnectedAtMs !== null && nowMs - selfSwitchConnectedAtMs < windowMs
}
