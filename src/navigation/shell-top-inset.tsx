/**
 * The top safe-area inset is spent ONCE. The shell's home bar spends it; every
 * header below it (`ScreenHeader`, `ScopeBar`) must then not spend it again.
 * A screen asks `useScreenTopInset()` instead of reading `insets.top`.
 */
import { createContext, useContext } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export const TopInsetSpentContext = createContext(false)

export function useScreenTopInset(): number {
  const spent = useContext(TopInsetSpentContext)
  const insets = useSafeAreaInsets()
  return spent ? 0 : insets.top
}
