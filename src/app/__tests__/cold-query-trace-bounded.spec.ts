/**
 * A trace bounded in TIME is not bounded.
 *
 * `attachColdQueryTrace` stops after {@link COLD_QUERY_TRACE_MS} (30 s), which
 * is the right window — a cold start is what it exists to explain. What it had
 * no bound on was VOLUME: it wrote a line for every query start AND every
 * success in that window, and a cold start fires hundreds. Measured on the
 * operator's phone 2026-09-09: six app launches in two hours produced 2 748
 * `cold-query` lines, up to 782 from a single launch — against `logger.ts`'s
 * own description of the always-ship scopes as "a handful of lines per launch
 * and per connection transition... Anything noisier belongs at `debug`".
 *
 * These lines ship to a hub already measured at 70–95% main thread, so the
 * cost is not only noise. The trace keeps its first {@link COLD_QUERY_MAX_LINES}
 * — which is where a cold-start latency question is actually answered — and
 * then says once, in one line, how many more there were.
 */
import { describe, expect, it } from 'vitest'
import { COLD_QUERY_MAX_LINES, createColdQueryBudget } from '../cold-query-budget.js'

describe('the cold-query trace budget', () => {
  it('admits the first lines, which is where the answer is', () => {
    const budget = createColdQueryBudget()
    for (let i = 0; i < COLD_QUERY_MAX_LINES; i++) {
      expect(budget.admit()).toBe('log')
    }
  })

  it('says once that it stopped, then stays silent', () => {
    const budget = createColdQueryBudget()
    for (let i = 0; i < COLD_QUERY_MAX_LINES; i++) budget.admit()
    expect(budget.admit()).toBe('summarise')
    for (let i = 0; i < 500; i++) expect(budget.admit()).toBe('drop')
  })

  it('counts what it dropped, so the summary is a number and not a shrug', () => {
    const budget = createColdQueryBudget()
    for (let i = 0; i < COLD_QUERY_MAX_LINES; i++) budget.admit()
    budget.admit()
    for (let i = 0; i < 42; i++) budget.admit()
    expect(budget.suppressed()).toBe(43)
  })

  it('is bounded well below what one launch measured', () => {
    expect(COLD_QUERY_MAX_LINES).toBeLessThan(782)
  })
})
