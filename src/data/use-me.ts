/**
 * Who is logged in — and in particular, whether they are an admin.
 *
 * The viewer knew the answer at login and threw it away: `HubAuthOutcome`
 * carries only `token` and `username`, so a session restored from storage at
 * boot (the usual case — the app rarely logs in) had no notion of role at all.
 * Rather than thread `isAdmin` through three separate login paths and persist
 * it, ask the hub: `auth.me` returns the session's identity and permissions,
 * and it is the SAME source the server uses when it enforces the gate.
 *
 * That last point is the reason this is not a local flag. Anything hidden here
 * is hidden for CONVENIENCE — the hub still refuses the mutation for a
 * non-admin. A viewer that decided the role for itself could drift from the
 * server's answer and show an operator a button that always fails.
 */
import { useMemo } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useServer } from '../app/ServerProvider.js'
import { sessionDiscriminator } from '../app/session-key.js'
import { parseUserScope, type UserScope } from '../hooks/user-scope.js'
import { grantedFeatures, holdsFeature, type ViewerFeatureId } from '../hooks/viewer-features.js'
import { capQuery } from './cap-query.js'

export interface SessionUser {
  readonly id: string
  readonly username: string
  readonly isAdmin: boolean
  /**
   * The hub's resolved effective scope, or `null` when this hub does not send
   * one (a build older than the scope model). `null` means UNKNOWN, never
   * "denied" — see `hooks/user-scope.ts` for why that distinction decides
   * whether a control is drawn.
   */
  readonly scope: UserScope | null
}

export function toSessionUser(raw: unknown): SessionUser | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r: Record<string, unknown> = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.username !== 'string') return null
  return {
    id: r.id,
    username: r.username,
    isAdmin: r.isAdmin === true,
    scope: parseUserScope(r.scope),
  }
}

/**
 * The session a `me` answer belongs to: the active hub and its token — the
 * token by its {@link sessionDiscriminator}, never verbatim.
 *
 * Derived from the TOKEN rather than a username because the viewer does not
 * store one (`ServerConfig` has none), and rather than a generation counter
 * bumped in each sign-in/out handler because that can miss a path: every
 * sign-in — another account, another hub, the same account again, the
 * hub-served web bootstrap — goes through `ServerProvider.save`, which always
 * installs a new token, so a key derived from the token changes on a path
 * added later too. Keyed on the SESSION token, which a silent renewal (D812)
 * leaves alone — same session, same answer.
 */
export function meQueryKey(serverUrl: string | null, token: string | null): readonly unknown[] {
  return ['v2', 'me', serverUrl, sessionDiscriminator(token)]
}

/**
 * The logged-in user. Identity does not change under a session, so this is
 * fetched once per session and never polled.
 *
 * A read that could not happen, or an answer without an identity, THROWS: the
 * query errors and `useAdminVerdict` says `unknown`. Returning `null` cached
 * "no answer" as "not admin" forever (`staleTime: Infinity`), and an admin's
 * save then dropped every other user's target (final review I1).
 */
export function useMe(): UseQueryResult<SessionUser> {
  const { controller, state } = useConnection()
  const { server, sessionToken } = useServer()
  return useQuery<SessionUser>({
    queryKey: meQueryKey(server?.serverUrl ?? null, sessionToken),
    enabled: state === 'connected',
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: false,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'auth',
        'me',
        undefined,
        { rethrow: true },
      )
      const user = toSessionUser(raw)
      if (user === null) throw new Error('auth.me answered without an identity')
      return user
    },
  })
}

/**
 * True only when the hub has CONFIRMED the session is an admin.
 *
 * Unknown reads as false — while `auth.me` is in flight, or on an older hub
 * without the procedure, the admin affordances stay hidden. Failing open would
 * offer every viewer user a control that disables a camera for the whole
 * household.
 */
export function useIsAdmin(): boolean {
  const { data } = useMe()
  return data?.isAdmin === true
}

/**
 * The named features this session holds (`auth.me.scope.features`): every one
 * for an admin, the listed ones for a viewer, none for anyone else — and none
 * while `auth.me` is unanswered (fail-closed, like {@link useIsAdmin}). A
 * feature's surfaces — a Library section, an assign button — are drawn only
 * when it is held, so a viewer never meets a control the hub will refuse.
 */
export function useGrantedFeatures(): readonly ViewerFeatureId[] {
  const { data } = useMe()
  return useMemo(() => grantedFeatures(data), [data])
}

/** Whether this session holds `feature`. Unknown reads as false. */
export function useHasFeature(feature: ViewerFeatureId): boolean {
  return holdsFeature(useGrantedFeatures(), feature)
}

/**
 * Whether the hub has ANSWERED the admin question yet.
 *
 * `useIsAdmin` fails closed, which is right for hiding an affordance and wrong
 * for a claim of absence: "this section does not exist" or a kind list without
 * System, shown while `auth.me` is still in flight, says something the hub
 * never said (D315). A screen that states absence waits for `pending` to end.
 *
 * `unknown` is a read that FAILED with nothing cached. For VISIBILITY it means
 * exactly what `not-admin` means — admin surfaces stay hidden, fail-closed,
 * as they did before the state had a name. It exists for the one consumer
 * where "not admin" is not the safe side: a notification editor's SAVE, whose
 * target policy depends on the role (`target-ownership.ts`). A real admin
 * whose `auth.me` failed must not save as a user, and a user must not save as
 * an admin, so Save waits (`save-gate.ts`).
 */
export type AdminVerdict = 'pending' | 'admin' | 'not-admin' | 'unknown'

/** The slice of the `auth.me` query a verdict is read from. */
export interface AdminVerdictSource {
  readonly isPending: boolean
  readonly isError: boolean
  readonly data: SessionUser | null | undefined
}

/** Pure: the verdict for a query state. An answer wins over a later error. */
export function adminVerdictFrom(source: AdminVerdictSource): AdminVerdict {
  if (source.isPending) return 'pending'
  if (source.data === undefined) return source.isError ? 'unknown' : 'not-admin'
  return source.data?.isAdmin === true ? 'admin' : 'not-admin'
}

export function useAdminVerdict(): AdminVerdict {
  const { data, isPending, isError } = useMe()
  return adminVerdictFrom({ isPending, isError, data })
}
