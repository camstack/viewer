/**
 * React Query hooks over the signed-in user's own sign-in methods and tokens.
 * The wire shapes and parsers live in `sign-in-methods.ts` and
 * `account-tokens.ts`; this file only wires them to the live connection.
 *
 * Keys carry the session identity (hub + hashed token), like `meQueryKey`: a
 * switch to another account or hub must never be answered from the previous
 * user's cache.
 */
import { useQuery, useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useServer } from '../app/ServerProvider.js'
import { sessionIdentity } from '../app/session-key.js'
import { BOOT_QUERY_DEADLINE_MS, withQueryDeadline } from './query-deadline.js'
import {
  parseBrowserHandoffPath,
  parseLinkClaim,
  parseLinkStartUrl,
  parseLinkableProviders,
  parseLinkedAccounts,
  parsePasskeys,
  parseSecondFactorPreference,
  parseTotpEnrollment,
  parseTotpStatus,
  type AuthSelfServiceClient,
  type LinkClaimOutcome,
  type LinkableProvider,
  type LinkedAccount,
  type PasskeyEntry,
  type TotpEnrollment,
  type TotpStatus,
} from './sign-in-methods.js'
import { parseMintedToken, parseTokens, type AccountToken, type MintInput, type MintedToken } from './account-tokens.js'
import { parseLoginSessions, type LoginSession } from './login-sessions.js'
import {
  beginLinkInput,
  beginPasskeyProof,
  disableTotp,
  proveIdentity,
  removePasskeyInput,
  type BeginLinkRequest,
  type ReauthCredential,
  type ReauthProof,
} from './sign-in-actions.js'
import { isMissingProcedureError } from '../auth/missing-procedure.js'

type Part = 'totp' | 'passkeys' | 'second-factor' | 'linked' | 'tokens' | 'sessions'

export function authSelfKey(serverUrl: string | null, token: string | null, part?: Part): readonly unknown[] {
  const base = ['v2', 'auth-self', sessionIdentity(serverUrl, token)]
  return part === undefined ? base : [...base, part]
}

/** The live client, or a throw the query/mutation reports as an error. */
function useAuthClient(): () => AuthSelfServiceClient {
  const { controller } = useConnection()
  return () => {
    const system = controller.getSystem()
    if (!system) throw new Error('not connected')
    // Documented type boundary: see `AuthSelfServiceClient`.
    return system.trpcClient as unknown as AuthSelfServiceClient
  }
}

function useSelfQuery<T>(part: Part, read: (client: AuthSelfServiceClient) => Promise<T>): UseQueryResult<T> {
  const { state } = useConnection()
  const { server, sessionToken } = useServer()
  const client = useAuthClient()
  return useQuery<T>({
    queryKey: authSelfKey(server?.serverUrl ?? null, sessionToken, part),
    enabled: state === 'connected',
    queryFn: () => withQueryDeadline(read(client()), `auth.${part}`, BOOT_QUERY_DEADLINE_MS),
  })
}

export function useTotpStatus(): UseQueryResult<TotpStatus> {
  return useSelfQuery('totp', async (c) => parseTotpStatus(await c.auth.getOwnTotpStatus.query()))
}

export function usePasskeys(): UseQueryResult<readonly PasskeyEntry[]> {
  return useSelfQuery('passkeys', async (c) => parsePasskeys(await c.auth.listOwnPasskeys.query()))
}

export function usePasskeySecondFactor(): UseQueryResult<boolean> {
  return useSelfQuery('second-factor', async (c) =>
    parseSecondFactorPreference(await c.auth.getOwnPasskeySecondFactorPreference.query()),
  )
}

export interface LinkedAccounts {
  readonly linked: readonly LinkedAccount[]
  readonly linkable: readonly LinkableProvider[]
}

export function useLinkedAccounts(): UseQueryResult<LinkedAccounts> {
  return useSelfQuery('linked', async (c) => {
    const [linked, linkable] = await Promise.all([
      c.auth.listOwnExternalIdentities.query(),
      c.auth.listLinkableProviders.query(),
    ])
    return { linked: parseLinkedAccounts(linked), linkable: parseLinkableProviders(linkable) }
  })
}

/**
 * The tokens the hub lists to this session (D895): the caller's own — an
 * admin's, everyone's, which the screen narrows (`ownTokens`). `null` on a hub
 * without the unified token surface.
 */
export function useTokens(): UseQueryResult<readonly AccountToken[] | null> {
  return useSelfQuery('tokens', async (c) => {
    try {
      return parseTokens(await c.auth.listTokens.query())
    } catch (err) {
      if (isMissingProcedureError(err)) return null
      throw err
    }
  })
}

/** This user's login sessions (D812); `null` on a hub without them. */
export function useOwnSessions(): UseQueryResult<readonly LoginSession[] | null> {
  return useSelfQuery('sessions', async (c) => {
    try {
      return parseLoginSessions(await c.auth.listOwnSessions.query())
    } catch (err) {
      if (isMissingProcedureError(err)) return null
      throw err
    }
  })
}

/**
 * Re-authentication (D813), OUTSIDE React Query: a wrong password answers
 * UNAUTHORIZED, which the mutation cache would take for a dead session.
 */
export function useReauthCalls(): {
  readonly prove: (credential: ReauthCredential) => Promise<ReauthProof>
  readonly passkeyOptions: () => Promise<Record<string, unknown>>
} {
  const client = useAuthClient()
  return {
    prove: (credential) => proveIdentity(client(), credential),
    passkeyOptions: () => beginPasskeyProof(client()),
  }
}

/** A mutation over the auth client that refreshes `parts` once it lands. */
function useSelfMutation<I, O>(parts: readonly Part[], run: (client: AuthSelfServiceClient, input: I) => Promise<O>) {
  const queryClient = useQueryClient()
  const { server, sessionToken } = useServer()
  const client = useAuthClient()
  return useMutation<O, Error, I>({
    mutationFn: (input) => run(client(), input),
    onSettled: () => {
      for (const part of parts) {
        void queryClient.invalidateQueries({ queryKey: authSelfKey(server?.serverUrl ?? null, sessionToken, part) })
      }
    },
  })
}

export function useChangePassword() {
  return useSelfMutation<{ currentPassword: string; newPassword: string }, void>([], async (c, input) => {
    await c.auth.changeOwnPassword.mutate(input)
  })
}

export function useSetupTotp() {
  return useSelfMutation<void, TotpEnrollment>([], async (c) => {
    const enrollment = parseTotpEnrollment(await c.auth.setupOwnTotp.mutate())
    if (enrollment === null) throw new Error('The hub answered without a TOTP secret')
    return enrollment
  })
}

export function useConfirmTotp() {
  return useSelfMutation<string, void>(['totp'], async (c, code) => {
    await c.auth.confirmOwnTotp.mutate({ code })
  })
}

/** Takes the re-authentication proof (`null` on a hub that asks for none). */
export function useDisableTotp() {
  return useSelfMutation<string | null, void>(['totp'], (c, reauthToken) => disableTotp(c, reauthToken))
}

export function useRemovePasskey() {
  return useSelfMutation<{ credentialId: string; reauthToken: string | null }, void>(
    ['passkeys', 'second-factor'],
    async (c, input) => {
      await c.auth.removeOwnPasskey.mutate(removePasskeyInput(input.credentialId, input.reauthToken))
    },
  )
}

export function useSetPasskeySecondFactor() {
  return useSelfMutation<boolean, void>(['second-factor'], async (c, enabled) => {
    await c.auth.setOwnPasskeySecondFactorPreference.mutate({ enabled })
  })
}

export function useUnlinkAccount() {
  return useSelfMutation<{ provider: string; subject: string }, void>(['linked'], async (c, input) => {
    await c.auth.unlinkOwnExternalIdentity.mutate(input)
  })
}

/**
 * Start linking `provider`; resolves to the URL the browser must open.
 * `returnTo` (native, D801) is the app's callback: the hub then hands the
 * outcome back there for {@link useClaimLink} instead of to its own page.
 */
export function useBeginLink() {
  return useSelfMutation<BeginLinkRequest & { readonly reauthToken: string | null }, string>([], async (c, input) => {
    const url = parseLinkStartUrl(await c.auth.beginExternalLink.mutate(beginLinkInput(input, input.reauthToken)))
    if (url === null) throw new Error('The hub answered without a link URL')
    return url
  })
}

/** Claim a native link the hub parked for this app (D801). */
export function useClaimLink() {
  return useSelfMutation<string, LinkClaimOutcome>(['linked'], async (c, code) => {
    const outcome = parseLinkClaim(await c.auth.completeExternalLink.mutate({ code }))
    if (outcome === null) throw new Error('The hub answered without a link outcome')
    return outcome
  })
}

/** A one-time hub path that opens the account page signed in, in a browser (D801). */
export function useBrowserHandoff() {
  return useSelfMutation<void, string>([], async (c) => {
    const path = parseBrowserHandoffPath(await c.auth.createBrowserHandoff.mutate())
    if (path === null) throw new Error('The hub answered without a handoff path')
    return path
  })
}

/** End another device's session (D812). */
export function useRevokeSession() {
  return useSelfMutation<string, void>(['sessions'], async (c, id) => {
    await c.auth.revokeOwnSession.mutate({ id })
  })
}

/** Mint one token; resolves with its secret (shown ONCE) and its row. */
export function useMintToken() {
  return useSelfMutation<MintInput & { readonly reauthToken: string | null }, MintedToken>(['tokens'], async (c, input) => {
    const minted = parseMintedToken(
      await c.auth.mintToken.mutate({
        scopes: input.scopes,
        expiresIn: input.expiresIn,
        label: input.label,
        ...(input.reauthToken !== null ? { reauthToken: input.reauthToken } : {}),
      }),
    )
    if (minted === null) throw new Error('The hub answered without a token')
    return minted
  })
}

/** Move one token's expiry in place (the same secret keeps working). */
export function useExtendToken() {
  return useSelfMutation<{ readonly id: string; readonly expiresIn: number | 'never' }, void>(['tokens'], async (c, input) => {
    await c.auth.extendToken.mutate({ id: input.id, expiresIn: input.expiresIn })
  })
}

export function useRevokeToken() {
  return useSelfMutation<string, void>(['tokens'], async (c, id) => {
    await c.auth.revokeToken.mutate({ id })
  })
}
