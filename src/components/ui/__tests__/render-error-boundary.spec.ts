import { describe, it, expect } from 'vitest'
import { reconcileBoundaryState, type RenderErrorBoundaryState } from '../RenderErrorBoundary.js'

const st = (over: Partial<RenderErrorBoundaryState> = {}): RenderErrorBoundaryState => ({
  hasError: false,
  lastResetKey: 'a',
  ...over,
})

describe('reconcileBoundaryState — clears latched error when resetKey changes', () => {
  it('returns null (no change) when the key is unchanged', () => {
    expect(reconcileBoundaryState(st({ hasError: true, lastResetKey: 'a' }), 'a')).toBeNull()
  })

  it('clears the error and adopts the new key when the key changes', () => {
    expect(reconcileBoundaryState(st({ hasError: true, lastResetKey: 'a' }), 'b')).toEqual({
      hasError: false,
      lastResetKey: 'b',
    })
  })

  it('reconciles an undefined key (adopts it once, then no-ops)', () => {
    expect(reconcileBoundaryState(st({ lastResetKey: 'a' }), undefined)).toEqual({
      hasError: false,
      lastResetKey: undefined,
    })
    expect(reconcileBoundaryState(st({ lastResetKey: undefined }), undefined)).toBeNull()
  })

  it('does not re-clear an error while the key stays the same across renders', () => {
    // A caught error must persist (fallback stays) until the wrapped content changes.
    expect(reconcileBoundaryState(st({ hasError: true, lastResetKey: 'x' }), 'x')).toBeNull()
  })
})
