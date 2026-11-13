/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useRunOnKeyChange } from '../use-run-on-key-change.js'

interface Props {
  readonly key: number
  readonly run: () => void
}

describe('useRunOnKeyChange', () => {
  it('runs once on mount and again only when the key changes', () => {
    const calls: string[] = []
    const make = (tag: string) => (): void => {
      calls.push(tag)
    }
    const hook = renderHook((p: Props) => useRunOnKeyChange(p.key, p.run), {
      initialProps: { key: 615, run: make('a') },
    })
    expect(calls).toEqual(['a'])

    // A new callback for the same camera (the zoom box resized): no run.
    hook.rerender({ key: 615, run: make('b') })
    hook.rerender({ key: 615, run: make('c') })
    expect(calls).toEqual(['a'])

    // A real camera change runs the LATEST callback.
    hook.rerender({ key: 617, run: make('d') })
    expect(calls).toEqual(['a', 'd'])
  })
})
