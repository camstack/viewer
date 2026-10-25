/**
 * The signed-in user's TOKENS (D895) — the pure half: the wire shapes of
 * `auth.listTokens` / `auth.mintToken`, what a token's row says, which tokens
 * can stand in for a share snippet, and the mint request the "New token"
 * sheet and the share dialogs build.
 *
 * There is one token format. What a token may do is its `scopes`; a share
 * link is a token whose only scope is a share-view grant, an admin token is a
 * token holding `'*'`. The hub enforces every rule below (90-day ceiling,
 * `'never'` only for a share-view grant, `'*'` behind a re-authentication);
 * this module mirrors them so the sheet never offers a choice the hub refuses.
 *
 * Pure (no React, no client): unit tested in `__tests__/account-tokens.spec.ts`.
 */
import { z } from 'zod'
import type { CredentialScope } from '@camstack/types'

// ── wire ────────────────────────────────────────────────────────────────────

/** The two embed perimeters a share-view grant can open. */
export const SHARE_VIEW_KINDS = ['grid-view', 'events-view'] as const
export type ShareViewKind = (typeof SHARE_VIEW_KINDS)[number]

/** Mirrors `SHARE_VIEW_MAX_DEVICES` (`@camstack/types`, not in the client entry). */
export const SHARE_VIEW_MAX_DEVICES = 64

const MethodAccessSchema = z.enum(['view', 'create', 'delete'])

// Mirrors `CredentialScopeSchema` (types, not in the client entry). The device
// selector kinds this build cannot evaluate (`types`, `locations`) parse, and
// simply never cover a camera list here.
const ScopeSchema = z.union([
  z.literal('*'),
  z.object({
    type: z.literal('share-view'),
    grant: z.object({
      kind: z.enum(SHARE_VIEW_KINDS),
      deviceIds: z.array(z.number().int().nonnegative()).min(1),
      talk: z.boolean().optional(),
    }),
  }),
  z.object({ type: z.literal('addon-routes'), access: z.array(MethodAccessSchema) }),
  z.object({ type: z.literal('preferences-self') }),
  z.object({
    type: z.literal('device'),
    selector: z.union([
      z.object({ kind: z.literal('all') }),
      z.object({ kind: z.literal('ids'), ids: z.array(z.number().int()) }),
      z.object({ kind: z.literal('types'), types: z.array(z.string()) }),
      z.object({ kind: z.literal('locations'), locations: z.array(z.string()) }),
    ]),
    access: z.array(MethodAccessSchema),
  }),
  z.object({ type: z.literal('category'), target: z.string(), access: z.array(MethodAccessSchema) }),
  z.object({ type: z.literal('capability'), target: z.string(), access: z.array(MethodAccessSchema) }),
  z.object({ type: z.literal('addon'), target: z.string(), access: z.array(MethodAccessSchema) }),
])

/** A scope this build cannot read (a newer hub's): listed as such, never matched. */
interface OtherScope {
  readonly type: 'other'
}

export type TokenScope = z.infer<typeof ScopeSchema> | OtherScope

function parseScope(raw: unknown): TokenScope {
  const parsed = ScopeSchema.safeParse(raw)
  return parsed.success ? parsed.data : { type: 'other' }
}

const TokenSummarySchema = z.object({
  id: z.string().min(1),
  subjectId: z.string(),
  label: z.string(),
  // One unreadable scope must not hide the token: it could then never be revoked.
  scopes: z.array(z.unknown()).transform((raw) => raw.map(parseScope)),
  createdAt: z.number(),
  expiresAt: z.number().nullable(),
  lastUsedAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
})
export type AccountToken = z.infer<typeof TokenSummarySchema>

/** A minted token: the secret, shown ONCE, and its row. */
export interface MintedToken {
  readonly token: string
  readonly record: AccountToken
}

const MintedTokenSchema = z.object({ token: z.string().min(1), record: TokenSummarySchema })

/** Every well-formed row, newest first; one malformed row costs that row only. */
export function parseTokens(raw: unknown): readonly AccountToken[] {
  if (!Array.isArray(raw)) return []
  return raw
    .flatMap((row) => {
      const parsed = TokenSummarySchema.safeParse(row)
      return parsed.success ? [parsed.data] : []
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function parseMintedToken(raw: unknown): MintedToken | null {
  const parsed = MintedTokenSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

// ── the list ────────────────────────────────────────────────────────────────

/**
 * This user's live-or-lapsed tokens. An admin's `listTokens` carries every
 * user's, and Settings → Account is about the signed-in user; a revoked token
 * is gone for good and is not listed.
 */
export function ownTokens(tokens: readonly AccountToken[], userId: string): readonly AccountToken[] {
  return tokens.filter((t) => t.subjectId === userId && t.revokedAt === null)
}

const DAY_MS = 86_400_000

/** A token closer to its expiry than this is highlighted. */
export const EXPIRY_WARNING_MS = 3 * DAY_MS

export type TokenExpiry = 'never' | 'ok' | 'soon' | 'expired'

export function tokenExpiry(token: Pick<AccountToken, 'expiresAt'>, now: number): TokenExpiry {
  if (token.expiresAt === null) return 'never'
  if (token.expiresAt <= now) return 'expired'
  return token.expiresAt - now < EXPIRY_WARNING_MS ? 'soon' : 'ok'
}

/** One scope in a few words: an i18n key under `v2.tokens.scope.` and its arguments. */
export interface ScopeLabel {
  readonly key: string
  readonly args?: Readonly<Record<string, string | number>>
}

function accessKey(access: readonly string[]): string {
  return access.includes('delete') || access.includes('create') ? 'manage' : 'view'
}

export function scopeLabel(scope: TokenScope): ScopeLabel {
  if (scope === '*') return { key: 'admin' }
  switch (scope.type) {
    case 'share-view':
      return {
        key: scope.grant.talk === true ? `${scope.grant.kind}-talk` : scope.grant.kind,
        args: { count: scope.grant.deviceIds.length },
      }
    case 'device':
      return scope.selector.kind === 'all'
        ? { key: `devices-all-${accessKey(scope.access)}` }
        : scope.selector.kind === 'ids'
          ? { key: `devices-${accessKey(scope.access)}`, args: { count: scope.selector.ids.length } }
          : { key: `devices-some-${accessKey(scope.access)}` }
    case 'category':
    case 'capability':
    case 'addon':
      return { key: `named-${accessKey(scope.access)}`, args: { name: scope.target } }
    case 'addon-routes':
      return { key: 'addon-routes' }
    case 'preferences-self':
      return { key: 'preferences' }
    case 'other':
      return { key: 'other' }
  }
}

/** The scopes as short labels, the admin bypass first. */
export function scopeLabels(scopes: readonly TokenScope[]): readonly ScopeLabel[] {
  const admin = scopes.includes('*')
  return admin ? [{ key: 'admin' }] : scopes.map(scopeLabel)
}

// ── coverage: which tokens a share snippet may use ──────────────────────────

function coversAll(granted: readonly number[], wanted: readonly number[]): boolean {
  const set = new Set(granted)
  return wanted.every((id) => set.has(id))
}

function scopeCovers(scope: TokenScope, kind: ShareViewKind, deviceIds: readonly number[]): boolean {
  if (scope === '*') return false
  if (scope.type === 'share-view') return scope.grant.kind === kind && coversAll(scope.grant.deviceIds, deviceIds)
  if (scope.type === 'device' && scope.access.includes('view')) {
    if (scope.selector.kind === 'all') return true
    if (scope.selector.kind === 'ids') return coversAll(scope.selector.ids, deviceIds)
  }
  return false
}

/**
 * The tokens that can open a `kind` embed of ALL `deviceIds`: live (not
 * revoked, not expired) and holding a share-view grant of that kind, or a
 * device view grant, over every one of the cameras. A `'*'` token is never
 * offered — an admin credential is not something to paste into a dashboard.
 */
export function tokensCovering(
  tokens: readonly AccountToken[],
  kind: ShareViewKind,
  deviceIds: readonly number[],
  now: number,
): readonly AccountToken[] {
  if (deviceIds.length === 0) return []
  return tokens.filter(
    (t) =>
      t.revokedAt === null &&
      tokenExpiry(t, now) !== 'expired' &&
      !t.scopes.includes('*') &&
      t.scopes.some((s) => scopeCovers(s, kind, deviceIds)),
  )
}

// ── minting ─────────────────────────────────────────────────────────────────

/** What a new token may do. `admin` is `'*'`, behind a re-authentication. */
export const TOKEN_PERMISSIONS = ['view', 'view-talk', 'admin'] as const
export type TokenPermission = (typeof TOKEN_PERMISSIONS)[number]

export const TOKEN_DURATIONS = ['1d', '7d', '30d', '90d', 'never'] as const
export type TokenDuration = (typeof TOKEN_DURATIONS)[number]

const DURATION_SEC: Readonly<Record<Exclude<TokenDuration, 'never'>, number>> = {
  '1d': 86_400,
  '7d': 7 * 86_400,
  '30d': 30 * 86_400,
  '90d': 90 * 86_400,
}

/** The lifetimes offered for a permission: `never` only for a view-only token. */
export function durationsFor(permission: TokenPermission): readonly TokenDuration[] {
  return permission === 'view' ? TOKEN_DURATIONS : TOKEN_DURATIONS.filter((d) => d !== 'never')
}

/** The duration to keep when the permission changes under it. */
export function durationAfterPermission(permission: TokenPermission, current: TokenDuration): TokenDuration {
  return durationsFor(permission).includes(current) ? current : '90d'
}

/**
 * The lifetimes an EXISTING token may be extended to: `never` only for a
 * view-only share token (one share-view grant, no talk-back), as for a new one.
 */
export function extendDurationsFor(token: Pick<AccountToken, 'scopes'>): readonly TokenDuration[] {
  const [only, ...rest] = token.scopes
  const viewOnly =
    rest.length === 0 && only !== undefined && only !== '*' && only.type === 'share-view' && only.grant.talk !== true
  return durationsFor(viewOnly ? 'view' : 'view-talk')
}

export function durationToExpiresIn(duration: TokenDuration): number | 'never' {
  return duration === 'never' ? 'never' : DURATION_SEC[duration]
}

export const TOKEN_LABEL_MAX = 80

export interface MintRequest {
  readonly label: string
  readonly permission: TokenPermission
  /** Which embed a view token opens. */
  readonly kind: ShareViewKind
  readonly deviceIds: readonly number[]
  readonly duration: TokenDuration
}

export interface MintInput {
  readonly label: string
  readonly scopes: readonly CredentialScope[]
  readonly expiresIn: number | 'never'
}

export type MintProblem = 'label' | 'cameras' | 'too-many-cameras' | 'duration'

/** Why the request cannot be sent yet, or `null`. */
export function mintProblem(request: MintRequest): MintProblem | null {
  const label = request.label.trim()
  if (label.length === 0 || label.length > TOKEN_LABEL_MAX) return 'label'
  if (!durationsFor(request.permission).includes(request.duration)) return 'duration'
  if (request.permission === 'admin') return null
  if (request.deviceIds.length === 0) return 'cameras'
  if (request.deviceIds.length > SHARE_VIEW_MAX_DEVICES) return 'too-many-cameras'
  return null
}

/** The `auth.mintToken` input (without the re-authentication proof). */
export function mintInput(request: MintRequest): MintInput {
  const scopes: readonly CredentialScope[] =
    request.permission === 'admin'
      ? ['*']
      : [
          {
            type: 'share-view',
            grant: {
              kind: request.kind,
              deviceIds: [...request.deviceIds],
              ...(request.permission === 'view-talk' ? { talk: true } : {}),
            },
          },
        ]
  return { label: request.label.trim(), scopes, expiresIn: durationToExpiresIn(request.duration) }
}

// ── the snippet placeholder ─────────────────────────────────────────────────

/** Where a token goes in a snippet the dialog shows before one exists. */
export const TOKEN_PLACEHOLDER = '{TOKEN}'

/** A stand-in with no characters a URL encoder would touch. */
const SENTINEL = 'CAMSTACKTOKENPLACEHOLDER'

/**
 * A snippet built by `build(token)` with the placeholder where the token goes.
 * The builders URL-encode the token, which would turn `{TOKEN}` into
 * `%7BTOKEN%7D` — so they are handed a sentinel and the sentinel is swapped.
 */
export function withTokenPlaceholder(build: (token: string) => string): string {
  return build(SENTINEL).split(SENTINEL).join(TOKEN_PLACEHOLDER)
}

/** The snippet with the real token in place of every placeholder (URL-encoded, as the builders do). */
export function fillTokenPlaceholder(snippet: string, token: string): string {
  return snippet.split(TOKEN_PLACEHOLDER).join(encodeURIComponent(token))
}

export function hasTokenPlaceholder(snippet: string): boolean {
  return snippet.includes(TOKEN_PLACEHOLDER)
}
