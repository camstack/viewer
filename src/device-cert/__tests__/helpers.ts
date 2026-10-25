/** Test doubles for the device-certificate modules: a key module, a store, a scripted hub. */
import type { FetchLike } from '../../auth/hub-auth-wire.js'
import type { KvStore } from '../../connection/server-store.js'
import { DeviceCertStore, keyAliasFor } from '../cert-store.js'
import { deviceTarget } from '../transport.js'
import type { DeviceCertDeps } from '../device-session.js'
import type { DeviceKeyModule } from '../types.js'

export const HUB = 'https://hub.example.com'
export const ORIGIN = 'https://hub.example.com'
export const HUB_KEY = 'hub-1'
export const TARGET = deviceTarget({ hubKey: HUB_KEY, liveUrl: HUB })

export interface FakeKeys extends DeviceKeyModule {
  readonly aliases: Set<string>
  readonly signed: string[]
  generated: number
}

export function fakeKeys(): FakeKeys {
  const aliases = new Set<string>()
  const signed: string[] = []
  const keys: FakeKeys = {
    aliases,
    signed,
    generated: 0,
    generate: async (alias) => {
      aliases.add(alias)
      keys.generated += 1
      return { publicKeySpki: `spki-${keys.generated}`, hardwareBacked: true }
    },
    getPublicKey: async (alias) => (aliases.has(alias) ? 'spki' : null),
    sign: async (alias, message) => {
      if (!aliases.has(alias)) throw new Error('no key')
      signed.push(message)
      return `sig-${signed.length}`
    },
    has: async (alias) => aliases.has(alias),
    delete: async (alias) => aliases.delete(alias),
  }
  return keys
}

export function memoryKv(): KvStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  }
}

export type Handler = (input: unknown, headers: Record<string, string>) => unknown | Response | Error

/** A hub whose procedures are scripted; a handler may throw to simulate a dead network. */
export function scriptedHub(handlers: Record<string, Handler>): {
  readonly fetchFn: FetchLike
  readonly calls: { procedure: string; input: unknown }[]
} {
  const calls: { procedure: string; input: unknown }[] = []
  const fetchFn: FetchLike = async (url, init) => {
    const procedure = url.slice(url.indexOf('/trpc/') + '/trpc/'.length)
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const input = typeof body === 'object' && body !== null && 'json' in body ? body.json : undefined
    calls.push({ procedure, input })
    const handler = handlers[procedure]
    if (handler === undefined) return new Response('{}', { status: 404 })
    const outcome = handler(input, Object.fromEntries(new Headers(init?.headers).entries()))
    if (outcome instanceof Error) throw outcome
    if (outcome instanceof Response) return outcome
    return new Response(JSON.stringify({ result: { data: { json: outcome } } }), { status: 200 })
  }
  return { fetchFn, calls }
}

export const trpcError = (status: number, message: string): Response =>
  new Response(JSON.stringify({ error: { json: { message } } }), { status })

export const refusal = (reason: string): { ok: false; reason: string; definitive: boolean } => ({
  ok: false,
  reason,
  definitive: ['revoked', 'unknown-credential', 'user-gone'].includes(reason),
})

export const CHALLENGE = (nonce = 'n1'): { ok: true; nonce: string; origin: string; expiresAt: number } => ({
  ok: true,
  nonce,
  origin: ORIGIN,
  expiresAt: 9_999_999_999_999,
})

export const LOGIN_OK = (certNotAfter: number): unknown => ({
  ok: true,
  token: 'tok',
  refreshToken: 'csr_1',
  user: { id: 'u1', username: 'wife' },
  certNotAfter,
})

export const DAY = 24 * 60 * 60 * 1000

export interface Rig {
  readonly deps: DeviceCertDeps
  readonly keys: FakeKeys
  readonly store: DeviceCertStore
  readonly kv: ReturnType<typeof memoryKv>
}

export function rig(fetchFn: FetchLike, now: () => number = () => 1_000_000): Rig {
  const keys = fakeKeys()
  const kv = memoryKv()
  const store = new DeviceCertStore(kv)
  return { deps: { keys, store, fetchFn, now }, keys, store, kv }
}

/** A hub with an enrolled device: key and record in place. */
export async function enrolled(
  r: Rig,
  over: { notAfter?: number; definitiveRefusals?: number; lastAutoReloginAt?: number; autoLogin?: boolean } = {},
): Promise<void> {
  r.keys.aliases.add(keyAliasFor(HUB_KEY))
  await r.store.put(HUB_KEY, {
    credentialId: 'cred-1',
    certPem: 'PEM-1',
    notAfter: over.notAfter ?? 1_000_000 + 300 * DAY,
    issuedAt: 0,
    username: 'wife',
    definitiveRefusals: over.definitiveRefusals ?? 0,
    autoLogin: over.autoLogin ?? true,
    ...(over.lastAutoReloginAt !== undefined ? { lastAutoReloginAt: over.lastAutoReloginAt } : {}),
  })
}
