/**
 * The signed-in user's login sessions (D812) — `auth.listOwnSessions` — as the
 * Sign-in methods screen lists them: which device, from where, when last used,
 * and which one is THIS app.
 *
 * Pure: the wire answer is parsed record by record, so one malformed row costs
 * that row. The device is read from the raw User-Agent the hub recorded at
 * sign-in with the same simple rules admin-ui's My access uses
 * (`components/auth/session-client.ts` in camstack-server) — not a UA database;
 * anything unrecognised is shown raw.
 */
import { isRecord } from './cap-query.js'

export interface LoginSession {
  readonly id: string
  /** How it signed in: `password`, `passkey`, `sso`, `handoff`, `exchange`, … */
  readonly method: string
  readonly lastUsedAt: number
  readonly expiresAt: number
  /** The raw User-Agent recorded at sign-in, or `null`. */
  readonly client: string | null
  readonly ip: string | null
  /** The session this app is using. */
  readonly current: boolean
}

function parseRow(raw: unknown): LoginSession | null {
  if (!isRecord(raw)) return null
  const { id, method, lastUsedAt, expiresAt, client, ip } = raw
  if (typeof id !== 'string' || typeof lastUsedAt !== 'number' || typeof expiresAt !== 'number') return null
  return {
    id,
    method: typeof method === 'string' ? method : '',
    lastUsedAt,
    expiresAt,
    client: typeof client === 'string' && client.length > 0 ? client : null,
    ip: typeof ip === 'string' && ip.length > 0 ? ip : null,
    current: raw.current === true,
  }
}

/** This app's session first, then the most recently used. */
export function parseLoginSessions(raw: unknown): readonly LoginSession[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(parseRow)
    .filter((row): row is LoginSession => row !== null)
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastUsedAt - a.lastUsedAt)
}

export type ClientDescription =
  | { readonly kind: 'app'; readonly os: 'iOS' | 'Android' }
  | { readonly kind: 'browser'; readonly browser: string; readonly os: string | null }
  | { readonly kind: 'other'; readonly label: string }
  | { readonly kind: 'unknown' }

interface Rule {
  readonly test: RegExp
  readonly name: string
}

/** Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari". */
const BROWSERS: readonly Rule[] = [
  { test: /Electron\//, name: 'CamStack desktop' },
  { test: /Edg(e|A|iOS)?\//, name: 'Edge' },
  { test: /OPR\/|Opera/, name: 'Opera' },
  { test: /Firefox\/|FxiOS\//, name: 'Firefox' },
  { test: /Chrome\/|CriOS\//, name: 'Chrome' },
  { test: /Version\/[\d.]+.*Safari\//, name: 'Safari' },
]

const SYSTEMS: readonly Rule[] = [
  { test: /iPhone/, name: 'iPhone' },
  { test: /iPad/, name: 'iPad' },
  { test: /Android/, name: 'Android' },
  { test: /Mac OS X|Macintosh/, name: 'macOS' },
  { test: /Windows/, name: 'Windows' },
  { test: /CrOS/, name: 'ChromeOS' },
  { test: /Linux/, name: 'Linux' },
]

/** How much of an unrecognised User-Agent a row shows. */
const RAW_MAX = 40

function firstMatch(rules: readonly Rule[], ua: string): string | null {
  return rules.find((r) => r.test.test(ua))?.name ?? null
}

export function describeClient(client: string | null): ClientDescription {
  const ua = client?.trim() ?? ''
  if (ua.length === 0) return { kind: 'unknown' }
  // The native apps call the hub through the platform HTTP stack.
  if (/CFNetwork\/.*Darwin\//.test(ua)) return { kind: 'app', os: 'iOS' }
  if (/^okhttp\//i.test(ua)) return { kind: 'app', os: 'Android' }
  const browser = firstMatch(BROWSERS, ua)
  if (browser !== null) return { kind: 'browser', browser, os: firstMatch(SYSTEMS, ua) }
  return { kind: 'other', label: ua.length <= RAW_MAX ? ua : `${ua.slice(0, RAW_MAX)}…` }
}
