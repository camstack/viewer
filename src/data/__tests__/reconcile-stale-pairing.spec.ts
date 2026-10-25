import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `refetchInterval: RECONCILE_MS` without an explicit `staleTime` is a bug, and
 * it has been shipped twice.
 *
 * `reconcile.ts` states the rule and why it is load-bearing: the global default
 * is `staleTime: 5000` (`src/app/query-client.ts`), so a query that intends to
 * be five minutes stale is considered stale after five SECONDS. React Query
 * then refetches it on the next mount, and every tab re-entry re-runs the whole
 * per-camera fan-out over a WebSocket that does not batch — the polls stop
 * being a backstop and become the mechanism again.
 *
 * Ten hooks were missing it on 2026-08-05. `useCurrentOccupancy` was missed by
 * that sweep and was still inheriting the 5s default on 2026-08-12 (419
 * dispatches in a 30 s cold-start trace). A prose rule that has been broken
 * eleven times is a guard that was never written.
 *
 * ## What this asserts
 *
 * Every `useQuery` block that declares `refetchInterval: RECONCILE_MS` also
 * declares SOME explicit `staleTime`. Deliberately not "staleTime must equal
 * RECONCILE_MS": `use-linked-devices` pairs the five-minute reconcile with a
 * documented 30 s window, which is a choice, not the defect. The defect is
 * INHERITING the 5 s default, and that is exactly what an absent `staleTime`
 * means.
 *
 * A source guard because this repo has no renderer (vitest runs `node`,
 * `*.spec.ts` only), so a mounted-query assertion is not available.
 */

const SRC = join(process.cwd(), 'src')

function walk(dir: string): readonly string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Each `useQuery(` … up to the next one. Coarse, but a hook file declares its
 *  options object immediately after the call, so the interval and the staleTime
 *  of one query always land in the same slice. */
function queryBlocks(source: string): readonly string[] {
  return source.split('useQuery').slice(1)
}

describe('RECONCILE_MS interval is always paired with an explicit staleTime', () => {
  const files = walk(SRC).filter((f) => !f.endsWith(join('data', 'reconcile.ts')))

  it('finds the hooks it is meant to police (the guard is not vacuous)', () => {
    const users = files.filter((f) => readFileSync(f, 'utf8').includes('refetchInterval: RECONCILE_MS'))
    expect(users.length).toBeGreaterThanOrEqual(8)
  })

  it('no query polls on the reconcile cadence while inheriting the 5s default staleTime', () => {
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      if (!source.includes('refetchInterval: RECONCILE_MS')) continue
      for (const block of queryBlocks(source)) {
        if (!block.includes('refetchInterval: RECONCILE_MS')) continue
        if (!block.includes('staleTime:')) offenders.push(file.slice(SRC.length + 1))
      }
    }
    expect(offenders).toEqual([])
  })
})
