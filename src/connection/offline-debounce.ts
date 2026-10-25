/**
 * Offline-state debouncer — the debounced state the root hub-status overlay reads.
 *
 * `disconnected` events are debounced: surface `connecting` immediately and
 * escalate to `disconnected` only when the drop OUTLASTS the grace window,
 * so a connect-time re-race or a transient blip never flashes "offline".
 *
 * `dispose()` is the load-bearing part: tearing down a `SystemController`
 * closes its `System`, whose WS `onClose` fires a FINAL `'disconnected'`
 * through the controller's still-attached `onStateChange` — synchronously,
 * DURING the React effect cleanup. Routing that terminal event into the old
 * effect's timer machinery used to arm a grace timer nobody could ever
 * clear (the owning cleanup had already run): it fired ~3s later, AFTER the
 * replacement controller (fresh post-login token) had connected, latching
 * the UI on "offline" until the app was force-closed. A disposed debouncer
 * therefore ignores every subsequent event and never fires its timer.
 */
import type { ConnState } from './recheck-policy.js'

export class OfflineDebouncer {
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(
    private readonly graceMs: number,
    private readonly apply: (state: ConnState) => void,
  ) {}

  /** Route a connection-state event into the debounced banner state. */
  handle(next: ConnState): void {
    if (this.disposed) return
    this.clearTimer()
    if (next === 'disconnected') {
      this.apply('connecting')
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.apply('disconnected')
      }, this.graceMs)
      return
    }
    this.apply(next)
  }

  /** Cancel any pending escalation and ignore all future events. */
  dispose(): void {
    this.disposed = true
    this.clearTimer()
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }
}
