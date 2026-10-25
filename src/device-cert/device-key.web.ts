/**
 * Web device key: a non-extractable WebCrypto ECDSA P-256 key pair persisted
 * in IndexedDB (a CryptoKey is structured-cloneable, so the private key is
 * stored without ever being readable). A browser has no hardware guarantee, so
 * `hardwareBacked` is false. Signatures are raw `r||s`, which the hub accepts.
 */
import { bytesToBase64Url } from './base64url.js'
import type { DeviceKeyModule } from './types.js'

const DB_NAME = 'camstack-device-key'
const STORE = 'keys'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
    })
  } finally {
    db.close()
  }
}

function isKeyPair(value: unknown): value is CryptoKeyPair {
  return typeof value === 'object' && value !== null && 'privateKey' in value && 'publicKey' in value
}

async function readPair(alias: string): Promise<CryptoKeyPair | null> {
  const stored: unknown = await withStore('readonly', (s) => s.get(alias))
  return isKeyPair(stored) ? stored : null
}

async function spkiOf(pair: CryptoKeyPair): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)))
}

/** A browser can hold the key when it has WebCrypto and IndexedDB. */
export const deviceKeysAvailable: boolean =
  typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined' && typeof indexedDB !== 'undefined'

export const deviceKeys: DeviceKeyModule = {
  generate: async (alias) => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
    await withStore('readwrite', (s) => s.put(pair, alias))
    return { publicKeySpki: await spkiOf(pair), hardwareBacked: false }
  },
  getPublicKey: async (alias) => {
    const pair = await readPair(alias)
    return pair === null ? null : spkiOf(pair)
  },
  sign: async (alias, message) => {
    const pair = await readPair(alias)
    if (pair === null) throw new Error('No device key for this alias')
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.privateKey,
      new TextEncoder().encode(message),
    )
    return bytesToBase64Url(new Uint8Array(signature))
  },
  has: async (alias) => (await readPair(alias)) !== null,
  delete: async (alias) => {
    const had = (await readPair(alias)) !== null
    await withStore('readwrite', (s) => s.delete(alias))
    return had
  },
}
