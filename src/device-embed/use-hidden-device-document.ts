/**
 * A hidden device-card document is kept, then dropped. Five minutes, or a
 * memory warning — whichever comes first. A document on screen is not dropped.
 */
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

/** How long a hidden device-card document is kept. */
export const DEVICE_CARD_DOCUMENT_TTL_MS = 5 * 60 * 1000

export function hiddenDocumentDecision(
  hidden: boolean,
  hiddenForMs: number,
  memoryWarning: boolean,
  ttlMs: number,
): 'keep' | 'drop' {
  if (!hidden) return 'keep'
  if (memoryWarning) return 'drop'
  if (hiddenForMs >= ttlMs) return 'drop'
  return 'keep'
}

/** Call `onDrop` once the hidden document has been hidden for the bound, or on a memory warning. */
export function useDropHiddenDocument(hidden: boolean, onDrop: () => void): void {
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop
  useEffect(() => {
    if (!hidden) return
    const fire = (): void => onDropRef.current()
    const timer = setTimeout(fire, DEVICE_CARD_DOCUMENT_TTL_MS)
    const sub = AppState.addEventListener('memoryWarning', fire)
    return () => {
      clearTimeout(timer)
      sub.remove()
    }
  }, [hidden])
}
