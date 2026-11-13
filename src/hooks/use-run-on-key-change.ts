import { useEffect, useRef } from 'react'

/**
 * Runs `run` when `key` changes — and only then (plus once on mount).
 *
 * A `useEffect` keyed on `[key, run]` also fires whenever `run` is a NEW
 * function, and a callback built from layout-dependent values is new on every
 * resize. That is how the live zoom was wiped after each pan on 2026-11-13: the
 * "camera change" snap re-ran every time the stream box changed height, with
 * the camera unchanged. The latest `run` is still the one called.
 */
export function useRunOnKeyChange<K>(key: K, run: () => void): void {
  const runRef = useRef(run)
  // Written in an effect, not during render (React Compiler); it is declared
  // first, so it runs before the key effect below in the same commit.
  useEffect(() => {
    runRef.current = run
  })
  const lastKey = useRef<{ readonly value: K } | null>(null)
  useEffect(() => {
    if (lastKey.current !== null && Object.is(lastKey.current.value, key)) return
    lastKey.current = { value: key }
    runRef.current()
  }, [key])
}
