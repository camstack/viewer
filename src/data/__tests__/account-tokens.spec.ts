/**
 * The pure token rules behind Settings → Account → Tokens and the share
 * dialogs: parsing the hub's rows, whose tokens are listed, the expiry
 * highlight, which tokens may stand in for a snippet ("covers every camera"),
 * the mint request, and the `{TOKEN}` placeholder.
 */
import { describe, expect, it } from 'vitest'
import {
  durationAfterPermission,
  durationsFor,
  extendDurationsFor,
  fillTokenPlaceholder,
  hasTokenPlaceholder,
  mintInput,
  mintProblem,
  ownTokens,
  parseMintedToken,
  parseTokens,
  scopeLabels,
  tokenExpiry,
  tokensCovering,
  withTokenPlaceholder,
  TOKEN_PLACEHOLDER,
  type AccountToken,
  type TokenScope,
} from '../account-tokens.js'

const DAY = 86_400_000
const NOW = 1_800_000_000_000

function token(id: string, scopes: readonly TokenScope[], over: Partial<AccountToken> = {}): AccountToken {
  return {
    id,
    subjectId: 'u1',
    label: id,
    scopes: [...scopes],
    createdAt: NOW - DAY,
    expiresAt: NOW + 30 * DAY,
    lastUsedAt: null,
    revokedAt: null,
    ...over,
  }
}

const gridView = (deviceIds: number[], talk?: boolean): TokenScope => ({
  type: 'share-view',
  grant: { kind: 'grid-view', deviceIds, ...(talk === undefined ? {} : { talk }) },
})

describe('parseTokens', () => {
  it('keeps well-formed rows newest first, and drops a malformed one alone', () => {
    const rows = parseTokens([
      { ...token('old', [gridView([1])]), createdAt: 1 },
      { id: 'broken' },
      { ...token('new', ['*']), createdAt: 2 },
    ])
    expect(rows.map((r) => r.id)).toEqual(['new', 'old'])
  })

  it('a scope this build cannot read keeps the token listed (it must stay revocable)', () => {
    const [row] = parseTokens([{ ...token('future', []), scopes: [{ type: 'quantum', x: 1 }] }])
    expect(row?.scopes).toEqual([{ type: 'other' }])
  })

  it('a non-array answer is no rows', () => {
    expect(parseTokens({ rows: [] })).toEqual([])
  })

  it('a mint answer carries the secret and the row', () => {
    expect(parseMintedToken({ token: 'secret', record: token('t', ['*']) })?.token).toBe('secret')
    expect(parseMintedToken({ record: token('t', ['*']) })).toBeNull()
  })
})

describe('ownTokens', () => {
  it("lists the signed-in user's live-or-lapsed tokens, never another user's or a revoked one", () => {
    const list = [
      token('mine', ['*']),
      token('theirs', ['*'], { subjectId: 'u2' }),
      token('revoked', ['*'], { revokedAt: NOW - 1 }),
      token('lapsed', ['*'], { expiresAt: NOW - DAY }),
    ]
    expect(ownTokens(list, 'u1').map((t) => t.id)).toEqual(['mine', 'lapsed'])
  })
})

describe('tokenExpiry', () => {
  it('highlights a token under three days from expiry', () => {
    expect(tokenExpiry({ expiresAt: null }, NOW)).toBe('never')
    expect(tokenExpiry({ expiresAt: NOW + 4 * DAY }, NOW)).toBe('ok')
    expect(tokenExpiry({ expiresAt: NOW + 3 * DAY }, NOW)).toBe('ok')
    expect(tokenExpiry({ expiresAt: NOW + 3 * DAY - 1 }, NOW)).toBe('soon')
    expect(tokenExpiry({ expiresAt: NOW }, NOW)).toBe('expired')
  })
})

describe('scopeLabels', () => {
  it('says each grant in a few words, admin alone', () => {
    expect(scopeLabels(['*', gridView([1])])).toEqual([{ key: 'admin' }])
    expect(scopeLabels([gridView([1, 2], true)])).toEqual([{ key: 'grid-view-talk', args: { count: 2 } }])
    expect(
      scopeLabels([
        { type: 'device', selector: { kind: 'all' }, access: ['view'] },
        { type: 'device', selector: { kind: 'ids', ids: [1, 2, 3] }, access: ['view', 'create'] },
        { type: 'capability', target: 'recording', access: ['view'] },
        { type: 'preferences-self' },
      ]),
    ).toEqual([
      { key: 'devices-all-view' },
      { key: 'devices-manage', args: { count: 3 } },
      { key: 'named-view', args: { name: 'recording' } },
      { key: 'preferences' },
    ])
  })
})

describe('tokensCovering — "covers ALL the view’s cameras"', () => {
  const list = [
    token('exact', [gridView([1, 2])]),
    token('wider', [gridView([1, 2, 3])]),
    token('partial', [gridView([1])]),
    token('events', [{ type: 'share-view', grant: { kind: 'events-view', deviceIds: [1, 2] } }]),
    token('device-all', [{ type: 'device', selector: { kind: 'all' }, access: ['view'] }]),
    token('device-ids', [{ type: 'device', selector: { kind: 'ids', ids: [2, 1] }, access: ['view'] }]),
    token('device-noview', [{ type: 'device', selector: { kind: 'all' }, access: ['create'] }]),
    token('device-types', [{ type: 'device', selector: { kind: 'types', types: ['camera'] }, access: ['view'] }]),
    token('admin', ['*']),
    token('expired', [gridView([1, 2])], { expiresAt: NOW - 1 }),
    token('revoked', [gridView([1, 2])], { revokedAt: NOW - 1 }),
  ]

  it('keeps the live tokens whose grant covers every camera, of the right kind', () => {
    expect(tokensCovering(list, 'grid-view', [1, 2], NOW).map((t) => t.id)).toEqual([
      'exact',
      'wider',
      'device-all',
      'device-ids',
    ])
  })

  it('an events view only takes an events grant (or a device view grant)', () => {
    expect(tokensCovering(list, 'events-view', [2, 1], NOW).map((t) => t.id)).toEqual([
      'events',
      'device-all',
      'device-ids',
    ])
  })

  it('a camera outside every grant leaves only the fleet-wide one', () => {
    expect(tokensCovering(list, 'grid-view', [1, 9], NOW).map((t) => t.id)).toEqual(['device-all'])
  })

  it('no cameras, no candidates', () => {
    expect(tokensCovering(list, 'grid-view', [], NOW)).toEqual([])
  })
})

describe('minting', () => {
  const base = { label: '  Kitchen wall ', permission: 'view' as const, kind: 'grid-view' as const, deviceIds: [3, 4], duration: '7d' as const }

  it('a view token is a lone share-view grant, trimmed label, seconds of life', () => {
    expect(mintInput(base)).toEqual({
      label: 'Kitchen wall',
      scopes: [{ type: 'share-view', grant: { kind: 'grid-view', deviceIds: [3, 4] } }],
      expiresIn: 7 * 86_400,
    })
  })

  it('view + talk grants talk-back; admin is the bypass with no cameras', () => {
    expect(mintInput({ ...base, permission: 'view-talk' }).scopes).toEqual([
      { type: 'share-view', grant: { kind: 'grid-view', deviceIds: [3, 4], talk: true } },
    ])
    expect(mintInput({ ...base, permission: 'admin', deviceIds: [] }).scopes).toEqual(['*'])
  })

  it('"never" only for a view-only token, as the hub rules', () => {
    expect(durationsFor('view')).toContain('never')
    expect(durationsFor('view-talk')).not.toContain('never')
    expect(durationsFor('admin')).not.toContain('never')
    expect(mintInput({ ...base, duration: 'never' }).expiresIn).toBe('never')
    expect(mintProblem({ ...base, permission: 'admin', duration: 'never' })).toBe('duration')
    expect(durationAfterPermission('admin', 'never')).toBe('90d')
    expect(durationAfterPermission('admin', '7d')).toBe('7d')
  })

  it('names what is missing', () => {
    expect(mintProblem(base)).toBeNull()
    expect(mintProblem({ ...base, label: '   ' })).toBe('label')
    expect(mintProblem({ ...base, deviceIds: [] })).toBe('cameras')
    expect(mintProblem({ ...base, deviceIds: Array.from({ length: 65 }, (_, i) => i) })).toBe('too-many-cameras')
    expect(mintProblem({ ...base, permission: 'admin', deviceIds: [] })).toBeNull()
  })

  it('an existing token extends to "never" only when it is view-only', () => {
    expect(extendDurationsFor({ scopes: [gridView([1])] })).toContain('never')
    expect(extendDurationsFor({ scopes: [gridView([1], true)] })).not.toContain('never')
    expect(extendDurationsFor({ scopes: ['*'] })).not.toContain('never')
  })
})

describe('the {TOKEN} placeholder', () => {
  const build = (t: string): string => `https://hub/embed?devices=1#t=${encodeURIComponent(t)}`

  it('survives a builder that URL-encodes the token', () => {
    const snippet = withTokenPlaceholder(build)
    expect(snippet).toBe(`https://hub/embed?devices=1#t=${TOKEN_PLACEHOLDER}`)
    expect(hasTokenPlaceholder(snippet)).toBe(true)
  })

  it('is replaced by the real token, encoded as the builder would', () => {
    const snippet = withTokenPlaceholder(build)
    expect(fillTokenPlaceholder(snippet, 'a.b_c-d')).toBe(build('a.b_c-d'))
    expect(fillTokenPlaceholder(snippet, 'x y')).toBe(build('x y'))
    expect(hasTokenPlaceholder(fillTokenPlaceholder(snippet, 'tok'))).toBe(false)
  })

  it('every placeholder is replaced', () => {
    expect(fillTokenPlaceholder(`${TOKEN_PLACEHOLDER} ${TOKEN_PLACEHOLDER}`, 't')).toBe('t t')
  })
})
