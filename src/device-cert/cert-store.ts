/**
 * The device certificate of each hub, in the platform secure store (keychain /
 * keystore; browser storage on web). The PRIVATE key is never here — it lives
 * in the key module and cannot be read at all. A certificate alone is a public
 * document; the record also keeps the revocation counter (D855 §7).
 *
 * Keyed by the app's HUB KEY (the saved server's id), not by an origin: the
 * LAN address, the public name and a tunnel are routes of ONE hub and share
 * one certificate. The key slot of the private key is named in the record.
 */
import { z } from 'zod'
import { secretKeySafe, type KvStore } from '../connection/server-store.js'
import type { DeviceCertRecord } from './types.js'

const RecordSchema = z.object({
  credentialId: z.string().min(1),
  certPem: z.string().min(1),
  notAfter: z.number(),
  issuedAt: z.number(),
  username: z.string(),
  definitiveRefusals: z.number().int().min(0),
  autoLogin: z.boolean().default(true),
  keyAlias: z.string().optional(),
  hubOrigin: z.string().optional(),
  keyHardwareBacked: z.boolean().optional(),
  enrolledAt: z.number().optional(),
  lastAutoReloginAt: z.number().optional(),
})

const keyFor = (origin: string): string => `v2.devicecert.${secretKeySafe(origin)}`

/** The base key alias of a hub; the two enrollment slots are `<base>.0` and `<base>.1`. */
export function keyAliasFor(hubKey: string): string {
  return secretKeySafe(hubKey)
}

/** Where the record's private key lives (a record from before slots used the base alias). */
export function activeAliasOf(hubKey: string, record: { readonly keyAlias?: string }): string {
  return record.keyAlias ?? keyAliasFor(hubKey)
}

/** The slot a NEW enrollment generates into: never the one holding the live key. */
export function spareAliasFor(hubKey: string, record: { readonly keyAlias?: string } | null): string {
  const base = keyAliasFor(hubKey)
  return record?.keyAlias === `${base}.0` ? `${base}.1` : `${base}.0`
}

/** Every alias a hub's key could be under. */
export function allAliasesFor(hubKey: string): readonly string[] {
  const base = keyAliasFor(hubKey)
  return [base, `${base}.0`, `${base}.1`]
}

export class DeviceCertStore {
  constructor(private readonly kv: KvStore) {}

  async get(origin: string): Promise<DeviceCertRecord | null> {
    const raw = await this.kv.getItem(keyFor(origin))
    if (raw === null) return null
    try {
      const parsed = RecordSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  async put(origin: string, record: DeviceCertRecord): Promise<void> {
    await this.kv.setItem(keyFor(origin), JSON.stringify(record))
  }

  async clear(origin: string): Promise<void> {
    await this.kv.removeItem(keyFor(origin))
  }
}
