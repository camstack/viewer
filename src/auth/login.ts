import { createSystem } from '@camstack/sdk'
import { HubUnreachableError } from './web-reachability.js'
import { hubLanguage } from '../connection/hub-language.js'

/** What a login leg answers. `refreshToken` only from a D812 hub. */
export interface LoginLegResult {
  readonly token: string
  readonly requiresTotp?: boolean
  readonly refreshToken?: string
}

/** The public login procedures a sign-in screen drives. */
export interface AuthClient {
  login(username: string, password: string): Promise<LoginLegResult>
  loginVerifyTotp(challengeToken: string, code: string): Promise<LoginLegResult>
  /** Release the transport. Called after every login leg, success or not. */
  close(): void
}

/**
 * The two login legs on the tRPC client, through a documented structural
 * boundary: the installed SDK's `login` / `loginVerifyTotp` helpers cannot
 * send `refreshable`, and its `AppRouter` type predates the flag.
 */
export interface LoginLegsClient {
  readonly auth: {
    readonly login: {
      mutate: (input: { username: string; password: string; refreshable: true }) => Promise<LoginLegResult>
    }
    readonly loginVerifyTotp: {
      mutate: (input: { challengeToken: string; code: string; refreshable: true }) => Promise<LoginLegResult>
    }
  }
}

/**
 * Both legs ask for a refreshing session (D812): a 2 h access token plus a
 * refresh token. An older hub strips the unknown flag and answers a
 * session-long token, which is how the app tells the two apart.
 */
export function authClientOver(legs: LoginLegsClient, close: () => void): AuthClient {
  return {
    login: (username, password) => legs.auth.login.mutate({ username, password, refreshable: true }),
    loginVerifyTotp: (challengeToken, code) =>
      legs.auth.loginVerifyTotp.mutate({ challengeToken, code, refreshable: true }),
    close,
  }
}

export type CreateAuthClient = (serverUrl: string) => AuthClient

/**
 * How long one login leg may wait for the hub before it is called unreachable.
 * A typo that resolves to an address nothing answers on is a TCP connect
 * timeout — over a minute of spinner with no reason given.
 */
export const LOGIN_REACH_TIMEOUT_MS = 15_000

/**
 * Default: a tokenless SDK System over plain HTTP (login/verifyTotp are public
 * request/response procedures).
 *
 * NOT the WebSocket the SDK picks by default in a browser: a socket that cannot
 * connect reconnects forever, and this client was never closed — every failed
 * attempt at an unreachable hub left one more retry loop behind
 * ("WebSocket connection to 'wss://…/trpc?connectionParams=1' failed", over and
 * over, with nothing on screen). A fetch fails ONCE, with an error the login
 * screen recognises.
 */
export const sdkAuthClient: CreateAuthClient = (serverUrl) => {
  const system = createSystem({ serverUrl, useWebSocket: false, getLanguage: hubLanguage })
  // Documented type boundary: see `LoginLegsClient`.
  return authClientOver(system.trpcClient as unknown as LoginLegsClient, () => system.close())
}

export interface LoginOutcome {
  /** 'success' → `token` is a session JWT; 'totp-required' → `token` is the challenge. */
  readonly status: 'success' | 'totp-required'
  readonly token: string
  /** The session's refresh token; `null` on a challenge or from an older hub. */
  readonly refreshToken: string | null
}

function refreshTokenOf(result: LoginLegResult): string | null {
  return typeof result.refreshToken === 'string' && result.refreshToken.length > 0 ? result.refreshToken : null
}

/** Run one leg on a fresh client: bounded in time, and always closed. */
async function withAuthClient<T>(
  serverUrl: string,
  create: CreateAuthClient,
  timeoutMs: number,
  leg: (client: AuthClient) => Promise<T>,
): Promise<T> {
  const client = create(serverUrl)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HubUnreachableError(serverUrl)), timeoutMs)
  })
  try {
    return await Promise.race([leg(client), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    client.close()
  }
}

export async function login(
  serverUrl: string,
  username: string,
  password: string,
  create: CreateAuthClient = sdkAuthClient,
  timeoutMs: number = LOGIN_REACH_TIMEOUT_MS,
): Promise<LoginOutcome> {
  const result = await withAuthClient(serverUrl, create, timeoutMs, (c) => c.login(username, password))
  return result.requiresTotp === true
    ? { status: 'totp-required', token: result.token, refreshToken: null }
    : { status: 'success', token: result.token, refreshToken: refreshTokenOf(result) }
}

export async function verifyTotp(
  serverUrl: string,
  challengeToken: string,
  code: string,
  create: CreateAuthClient = sdkAuthClient,
  timeoutMs: number = LOGIN_REACH_TIMEOUT_MS,
): Promise<{ token: string; refreshToken: string | null }> {
  const result = await withAuthClient(serverUrl, create, timeoutMs, (c) =>
    c.loginVerifyTotp(challengeToken, code),
  )
  return { token: result.token, refreshToken: refreshTokenOf(result) }
}
