/**
 * Keeping the active session alive (D812) — the React half of
 * `auth/session-renewer.ts`.
 *
 * One entry, `renewSession(reason)`, for the three moments a renewal is due:
 *
 *  - `scheduled` — before the access token expires (half its remaining life,
 *    `refreshDelayMs`): with 2 h tokens, about once an hour while in use;
 *  - `resume` — the app comes to the foreground with a token that has expired
 *    (or is about to) while it was suspended and no timer could run;
 *  - `unauthorized` — the hub refused the token (a query, the connect probe,
 *    the resume probe). Renew first; ONLY a refused renewal signs out.
 *
 * A renewal updates the live token everywhere it is used: React state (every
 * Bearer-header fetch reads it), storage (`session-renewer.ts`, rotated
 * refresh token first) and the live `System` in place — no reconnect, unless
 * the token was refused (a socket that authenticated with a dead token stays
 * unauthenticated until it reconnects) or the renewal moved to a new session.
 * In the second case the superseded session is then ended on the hub.
 *
 * Concurrent callers share one renewal and its side effects: a burst of
 * UNAUTHORIZED queries is one refresh and at most one reconnect.
 */
import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import type { ServerConfig } from '../connection/server-store.js'
import type { SessionRenewer } from '../auth/session-renewer.js'
import type { RenewClient, RenewOutcome } from '../auth/refresh-session.js'
import { logoutFromHub } from '../auth/hub-logout.js'
import { isJwtExpired, refreshDelayMs } from '../auth/session-token.js'
import { setUnauthorizedHandler } from '../auth/unauthorized-signal.js'
import { createRenewalCooldown } from '../auth/renewal-cooldown.js'
import { log } from '../lib/logger.js'

export type RenewReason = 'scheduled' | 'resume' | 'unauthorized'

/** The slice of the live SDK `System` a renewal touches. */
export interface LiveSystem {
  readonly serverUrl: string
  readonly trpcClient: unknown
  setToken(token: string): void
  reconnect(): void
}

/** How the connection lends its live System; `null` detaches. */
export type AttachSystem = (getSystem: (() => LiveSystem | null) | null) => void

/** Retry a renewal that could not run (offline, no connection) this soon. */
const RETRY_EXPIRED_MS = 60_000
/** On resume, renew a token that expires within this window. */
const RESUME_SKEW_MS = 60_000
/**
 * UNAUTHORIZED answers this soon after a renewal are requests that left with
 * the OLD token, landing late — renewing again for each would rotate the
 * refresh token in a loop and run into the hub's rate limit.
 */
const STRAGGLER_WINDOW_MS = 15_000

const UNAVAILABLE: RenewOutcome = { status: 'unavailable' }

export interface SessionRenewalOptions {
  /** Shared with the boot and switch paths (single flight per server). */
  readonly renewer: SessionRenewer
  readonly server: ServerConfig | null
  /** The live access token. */
  readonly token: string | null
  /** Install a renewed token as the live one (React state). */
  readonly onRenewed: (token: string) => void
  /** The hub ended this server's session: forget it locally. */
  readonly onSignedOut: (serverId: string) => Promise<void>
}

export interface SessionRenewal {
  readonly renewSession: (reason: RenewReason) => Promise<RenewOutcome>
  readonly attachSystem: AttachSystem
}

export function useSessionRenewal(options: SessionRenewalOptions): SessionRenewal {
  const { renewer, server, token, onRenewed, onSignedOut } = options

  const tokenRef = useRef(token)
  const serverRef = useRef(server)
  const systemRef = useRef<(() => LiveSystem | null) | null>(null)
  const inflightRef = useRef<Promise<RenewOutcome> | null>(null)
  /** An `unauthorized` caller joined the renewal in flight: reconnect after it. */
  const reconnectRef = useRef(false)
  const cooldownRef = useRef(createRenewalCooldown())
  const lastRenewedRef = useRef<{
    readonly serverId: string
    readonly at: number
    readonly outcome: RenewOutcome
  } | null>(null)
  useEffect(() => {
    tokenRef.current = token
    serverRef.current = server
  }, [token, server])

  const attachSystem = useCallback<AttachSystem>((getSystem) => {
    systemRef.current = getSystem
  }, [])

  const run = useCallback(async (): Promise<RenewOutcome> => {
    const active = serverRef.current
    const current = tokenRef.current
    if (active === null || current === null) {
      reconnectRef.current = false
      return UNAVAILABLE
    }
    const system = systemRef.current?.() ?? null
    const outcome = await renewer.renew(active.id, {
      serverUrl: system?.serverUrl ?? active.serverUrl,
      currentToken: current,
      // Documented type boundary: see `RenewClient`.
      client: system === null ? null : (system.trpcClient as RenewClient),
    })
    const reconnect = reconnectRef.current
    reconnectRef.current = false
    // Switched away meanwhile: the renewer stored it in that server's slot,
    // and the live state now belongs to another server.
    if (serverRef.current?.id !== active.id) return outcome
    if (outcome.status === 'renewed') {
      lastRenewedRef.current = { serverId: active.id, at: Date.now(), outcome }
      tokenRef.current = outcome.token
      onRenewed(outcome.token)
      if (system !== null) {
        system.setToken(outcome.token)
        if (reconnect || outcome.supersededToken !== null) system.reconnect()
      }
      if (outcome.supersededToken !== null) {
        const ended = await logoutFromHub({
          serverUrl: active.serverUrl,
          token: outcome.supersededToken,
          refreshToken: null,
          everywhere: false,
        })
        log.info('session', 'Moved to a refreshing session', { previousEnded: ended })
      }
      return outcome
    }
    if (outcome.status === 'refused' || (reconnect && outcome.status === 'unavailable')) {
      log.info('session', 'Session ended by the hub — signing out', { status: outcome.status })
      await onSignedOut(active.id)
    } else if (outcome.status === 'failed') {
      log.warn('session', 'Session renewal failed — will retry', { message: outcome.message })
    }
    return outcome
  }, [renewer, onRenewed, onSignedOut])

  const renewSession = useCallback(
    (reason: RenewReason): Promise<RenewOutcome> => {
      const last = lastRenewedRef.current
      const straggler =
        last !== null && last.serverId === serverRef.current?.id && Date.now() - last.at < STRAGGLER_WINDOW_MS
      if (reason === 'unauthorized' && straggler) {
        return Promise.resolve(last.outcome)
      }
      // A renewal that could not settle is not asked again by every poll behind it.
      const cooling =
        reason === 'unauthorized' && serverRef.current !== null
          ? cooldownRef.current.active(serverRef.current.id)
          : null
      if (cooling !== null) return Promise.resolve(cooling)
      if (reason === 'unauthorized') reconnectRef.current = true
      const pending = inflightRef.current
      if (pending !== null) return pending
      const askedFor = serverRef.current?.id ?? null
      const started = run()
        .then((outcome) => {
          if (askedFor !== null) cooldownRef.current.record(askedFor, outcome)
          return outcome
        })
        .finally(() => {
          inflightRef.current = null
        })
      inflightRef.current = started
      return started
    },
    [run],
  )

  const renewRef = useRef(renewSession)
  useEffect(() => {
    renewRef.current = renewSession
  }, [renewSession])

  // Scheduled: before the token expires. A renewed token re-runs this effect;
  // one that could not be renewed is retried.
  const serverId = server?.id ?? null
  useEffect(() => {
    if (serverId === null || token === null) return undefined
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (delay: number): void => {
      timer = setTimeout(() => {
        void renewRef.current('scheduled').then((outcome) => {
          if (cancelled || outcome.status === 'renewed' || outcome.status === 'refused') return
          schedule(refreshDelayMs(token) ?? RETRY_EXPIRED_MS)
        })
      }, delay)
    }
    const delay = refreshDelayMs(token)
    if (delay !== null) schedule(delay)
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [serverId, token])

  // Resume: a suspended app ran no timer.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const current = tokenRef.current
      if (state !== 'active' || current === null) return
      if (isJwtExpired(current, Date.now(), RESUME_SKEW_MS)) void renewRef.current('resume')
    })
    return () => subscription.remove()
  }, [])

  // Every query / mutation answered UNAUTHORIZED.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void renewRef.current('unauthorized')
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  return { renewSession, attachSystem }
}
