/**
 * useDebouncedValue — return `value` delayed by `delayMs`. The debounced value
 * only updates once the input has been stable for the delay, so a search box can
 * drive a query without firing on every keystroke.
 */
import { useEffect, useState } from 'react'

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}
