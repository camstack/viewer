/**
 * What an editor shows for a failed request: the app's own errors translated
 * (`nc-errors.ts`), a hub refusal verbatim (`RuleErrorBanner` says why).
 */
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ncErrorKey } from '../../data/nc-errors.js'

export type NcErrorText = (error: Error | null | undefined) => string | null

export function useNcErrorText(): NcErrorText {
  const { t } = useTranslation()
  return useCallback(
    (error: Error | null | undefined): string | null => {
      if (error === null || error === undefined) return null
      const key = ncErrorKey(error)
      return key !== undefined ? t(key) : error.message
    },
    [t],
  )
}
