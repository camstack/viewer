/**
 * What a token's row SAYS — the scopes in a few words and its dates — shared
 * by Settings → Account → Tokens and the share dialogs' "use an existing
 * token" list, so one token reads the same in both places.
 */
import { useTranslation } from 'react-i18next'
import { useDateLocale } from '../../lib/date-locale.js'
import { scopeLabels, tokenExpiry, type AccountToken } from '../../data/account-tokens.js'

export interface TokenText {
  /** The scopes, short: "Grid view · 3 cameras, Talk-back". */
  readonly scopes: (token: AccountToken) => string
  /** "Created 3 Oct · Expires 10 Oct · Last used 9 Oct". */
  readonly dates: (token: AccountToken, now: number) => string
  /** "Expires 10 Oct" / "Never expires" / "Expired 1 Oct". */
  readonly expiry: (token: AccountToken, now: number) => string
  readonly day: (ms: number) => string
}

export function useTokenText(): TokenText {
  const { t } = useTranslation()
  const locale = useDateLocale()
  const day = (ms: number): string =>
    new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  const expiry = (token: AccountToken, now: number): string => {
    const state = tokenExpiry(token, now)
    if (state === 'never' || token.expiresAt === null) return t('v2.tokens.neverExpires')
    return t(state === 'expired' ? 'v2.tokens.expired' : 'v2.tokens.expires', { date: day(token.expiresAt) })
  }
  return {
    day,
    expiry,
    scopes: (token) => scopeLabels(token.scopes).map((l) => t(`v2.tokens.scope.${l.key}`, l.args ?? {})).join(', '),
    dates: (token, now) =>
      [
        t('v2.tokens.created', { date: day(token.createdAt) }),
        expiry(token, now),
        token.lastUsedAt === null ? t('v2.tokens.neverUsed') : t('v2.tokens.lastUsed', { date: day(token.lastUsedAt) }),
      ].join(' · '),
  }
}
