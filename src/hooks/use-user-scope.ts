/**
 * useUserScope — the React binding for `hooks/user-scope.ts`.
 *
 * One source, one cache: the scope rides on `auth.me`, which `useMe` already
 * fetches once per session with `staleTime: Infinity`. There is no second
 * query, no second key, and nothing here to invalidate — a session's grants do
 * not change under it, and a session whose grants DID change gets a new
 * `auth.me` the next time it connects.
 *
 * Read the rules in `user-scope.ts` before gating anything with this. The short
 * version: hide only on a CONFIRMED denial, and `isAdmin` is the one grade that
 * stays fail-closed.
 */
import { useMemo } from 'react'
import { useMe } from '../data/use-me.js'
import { allowsGrade, resolveSessionScopeView, type ScopeView, type SurfaceGrade } from './user-scope.js'

/** The session's scope, reduced to the questions components ask. */
export function useUserScope(): ScopeView {
  const { data } = useMe()
  const isAdmin = data?.isAdmin === true
  const scope = data?.scope ?? null
  return useMemo(
    () => resolveSessionScopeView(data === undefined || data === null ? null : { isAdmin, scope }),
    [data, isAdmin, scope],
  )
}

/**
 * Whether a surface of this grade may be drawn.
 *
 * The answer is HIDE or SHOW — never "show it greyed out". A control the hub
 * will refuse is worse than no control: it advertises a capability the session
 * does not have and gives the operator nothing to do about it.
 */
export function useAllowsGrade(grade: SurfaceGrade): boolean {
  const view = useUserScope()
  return allowsGrade(view, grade)
}

/** Shorthand for the commonest gate: may this session act on a device at all? */
export function useCanActuate(): boolean {
  return useUserScope().canActuate
}

/** Shorthand for the destructive grade (prune / delete stored media). */
export function useCanDelete(): boolean {
  return useUserScope().canDelete
}
