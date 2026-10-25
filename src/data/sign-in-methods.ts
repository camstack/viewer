/**
 * Sign-in methods of the signed-in user — the wire boundary.
 *
 * The hub's self-service auth procedures (`auth.changeOwnPassword`, the TOTP,
 * passkey and linked-account families) bind every call to the CALLER's session
 * (`ctx.user.id`), so this screen can only ever read or change its own user.
 *
 * Reached through a documented structural boundary, like `refresh-session.ts`:
 * the installed `AppRouter` type predates several of these procedures. Every
 * answer is `unknown` here and parsed field by field below, so a hub that sends
 * a shape this build does not know degrades one row instead of the screen.
 */
import { isRecord } from './cap-query.js'

/** The procedures this screen calls. Answers are parsed, never trusted. */
export interface AuthSelfServiceClient {
  readonly auth: {
    readonly changeOwnPassword: {
      mutate: (input: { currentPassword: string; newPassword: string }) => Promise<unknown>
    }
    readonly getOwnTotpStatus: { query: () => Promise<unknown> }
    readonly setupOwnTotp: { mutate: () => Promise<unknown> }
    readonly confirmOwnTotp: { mutate: (input: { code: string }) => Promise<unknown> }
    /** No input on a hub before D813; `{ reauthToken }` after. */
    readonly disableOwnTotp: { mutate: (input?: { reauthToken: string }) => Promise<unknown> }
    readonly listOwnPasskeys: { query: () => Promise<unknown> }
    readonly removeOwnPasskey: {
      mutate: (input: { credentialId: string; reauthToken?: string }) => Promise<unknown>
    }
    readonly getOwnPasskeySecondFactorPreference: { query: () => Promise<unknown> }
    readonly setOwnPasskeySecondFactorPreference: { mutate: (input: { enabled: boolean }) => Promise<unknown> }
    readonly listLinkableProviders: { query: () => Promise<unknown> }
    readonly listOwnExternalIdentities: { query: () => Promise<unknown> }
    readonly unlinkOwnExternalIdentity: {
      mutate: (input: { provider: string; subject: string }) => Promise<unknown>
    }
    readonly beginExternalLink: {
      mutate: (input: { provider: string; returnTo?: string; reauthToken?: string }) => Promise<unknown>
    }
    readonly completeExternalLink: { mutate: (input: { code: string }) => Promise<unknown> }
    readonly createBrowserHandoff: { mutate: () => Promise<unknown> }
    /** D813: the current password, or a passkey assertion from `reauthBeginPasskey`. */
    readonly reauthenticate: {
      mutate: (input: { password: string } | { passkeyResponse: Record<string, unknown> }) => Promise<unknown>
    }
    readonly reauthBeginPasskey: { mutate: () => Promise<unknown> }
    /** D812. */
    readonly listOwnSessions: { query: () => Promise<unknown> }
    readonly revokeOwnSession: { mutate: (input: { id: string }) => Promise<unknown> }
    /** D895: the one token surface. An admin's list carries every user's tokens. */
    readonly listTokens: { query: (input?: { label?: string }) => Promise<unknown> }
    readonly mintToken: {
      mutate: (input: {
        scopes: readonly unknown[]
        expiresIn: number | 'never'
        label: string
        reauthToken?: string
      }) => Promise<unknown>
    }
    readonly extendToken: { mutate: (input: { id: string; expiresIn: number | 'never' }) => Promise<unknown> }
    readonly revokeToken: { mutate: (input: { id: string }) => Promise<unknown> }
  }
}

/** The hub's minimum, mirrored so the form refuses before the round trip. */
export const MIN_PASSWORD_LENGTH = 8
/** An authenticator code. */
export const TOTP_CODE_LENGTH = 6

export interface TotpStatus {
  readonly enabled: boolean
  readonly confirmedAt: number | null
}

export interface TotpEnrollment {
  readonly secret: string
  readonly otpauthUrl: string
}

export interface PasskeyEntry {
  readonly credentialId: string
  readonly label: string
  readonly createdAt: number
  readonly lastUsedAt: number | null
}

export interface LinkableProvider {
  readonly provider: string
  readonly label: string
}

export interface LinkedAccount {
  readonly provider: string
  readonly subject: string
  /** The account at the provider (an e-mail, a username), when the hub knows one. */
  readonly accountLabel: string | null
  readonly linkedAt: number
  /** The provider's button label; `null` when the provider is gone. */
  readonly providerLabel: string | null
  /** False when the provider instance is gone or switched off — the link
   *  survives, but it cannot sign anyone in until it comes back. */
  readonly available: boolean
}

export function parseTotpStatus(raw: unknown): TotpStatus {
  if (!isRecord(raw)) return { enabled: false, confirmedAt: null }
  return {
    enabled: raw.enabled === true,
    confirmedAt: typeof raw.confirmedAt === 'number' ? raw.confirmedAt : null,
  }
}

export function parseTotpEnrollment(raw: unknown): TotpEnrollment | null {
  if (!isRecord(raw)) return null
  const { secret, otpauthUrl } = raw
  if (typeof secret !== 'string' || secret.length === 0) return null
  if (typeof otpauthUrl !== 'string' || !otpauthUrl.startsWith('otpauth://')) return null
  return { secret, otpauthUrl }
}

function listOf<T>(raw: unknown, parse: (item: unknown) => T | null): readonly T[] {
  if (!Array.isArray(raw)) return []
  return raw.map(parse).filter((item): item is T => item !== null)
}

export function parsePasskeys(raw: unknown): readonly PasskeyEntry[] {
  return listOf(raw, (item) => {
    if (!isRecord(item)) return null
    const { credentialId, label, createdAt, lastUsedAt } = item
    if (typeof credentialId !== 'string' || typeof createdAt !== 'number') return null
    return {
      credentialId,
      label: typeof label === 'string' ? label : '',
      createdAt,
      lastUsedAt: typeof lastUsedAt === 'number' ? lastUsedAt : null,
    }
  })
}

export function parseSecondFactorPreference(raw: unknown): boolean {
  return isRecord(raw) && raw.enabled === true
}

export function parseLinkableProviders(raw: unknown): readonly LinkableProvider[] {
  return listOf(raw, (item) => {
    if (!isRecord(item)) return null
    const { provider, label } = item
    if (typeof provider !== 'string' || provider.length === 0) return null
    return { provider, label: typeof label === 'string' && label.length > 0 ? label : provider }
  })
}

export function parseLinkedAccounts(raw: unknown): readonly LinkedAccount[] {
  return listOf(raw, (item) => {
    if (!isRecord(item)) return null
    const { provider, subject, label, linkedAt, providerLabel } = item
    if (typeof provider !== 'string' || typeof subject !== 'string') return null
    return {
      provider,
      subject,
      accountLabel: typeof label === 'string' && label.length > 0 ? label : null,
      linkedAt: typeof linkedAt === 'number' ? linkedAt : 0,
      providerLabel: typeof providerLabel === 'string' ? providerLabel : null,
      available: item.available === true,
    }
  })
}

/** The URL `beginExternalLink` answers with, or `null`. */
export function parseLinkStartUrl(raw: unknown): string | null {
  return isRecord(raw) && typeof raw.url === 'string' && raw.url.length > 0 ? raw.url : null
}

/**
 * Providers the operator could still link: linkable, and not already linked.
 * One identity per provider is what the Link button offers; a second account at
 * the same provider is still possible from admin-ui, which lists by subject.
 */
export function providersToLink(
  linkable: readonly LinkableProvider[],
  linked: readonly LinkedAccount[],
): readonly LinkableProvider[] {
  const taken = new Set(linked.map((l) => l.provider))
  return linkable.filter((p) => !taken.has(p.provider))
}

export type PasswordFormProblem = 'missing-current' | 'too-short' | 'mismatch' | 'unchanged'

/** Why the change-password form cannot be sent yet, or `null` when it can. */
export function passwordFormProblem(input: {
  readonly current: string
  readonly next: string
  readonly confirm: string
}): PasswordFormProblem | null {
  if (input.current.length === 0) return 'missing-current'
  if (input.next.length < MIN_PASSWORD_LENGTH) return 'too-short'
  if (input.next !== input.confirm) return 'mismatch'
  if (input.next === input.current) return 'unchanged'
  return null
}

/** Digits only, at most six — what an authenticator shows. */
export function normalizeTotpCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, TOTP_CODE_LENGTH)
}

/** The base32 secret in groups of four, for reading it off one screen into another. */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ')
}

/** How a native link claim ended (`auth.completeExternalLink`, D801). */
export type LinkClaimOutcome = 'linked' | 'conflict' | 'expired' | 'session'

export function parseLinkClaim(raw: unknown): LinkClaimOutcome | null {
  if (!isRecord(raw)) return null
  const outcome = raw.outcome
  return outcome === 'linked' || outcome === 'conflict' || outcome === 'expired' || outcome === 'session'
    ? outcome
    : null
}

/** The hub-relative path a browser handoff opens, or `null`. */
export function parseBrowserHandoffPath(raw: unknown): string | null {
  if (!isRecord(raw) || typeof raw.path !== 'string') return null
  return raw.path.startsWith('/api/auth/browser-handoff?') ? raw.path : null
}

/**
 * What the app's callback carries back from a native link (D801):
 * `?link=<code>` to claim, or `?linkError=<reason>`. `null` when neither.
 */
export function parseLinkCallback(url: string): { readonly code: string } | { readonly error: string } | null {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return null
  const params = new URLSearchParams(url.slice(queryStart + 1).split('#')[0] ?? '')
  const error = params.get('linkError')
  if (error !== null && error.length > 0) return { error }
  const code = params.get('link')
  return code !== null && code.length > 0 ? { code } : null
}
