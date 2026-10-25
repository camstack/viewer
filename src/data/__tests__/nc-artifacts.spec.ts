import { describe, it, expect, vi } from 'vitest'
import {
  NC_ARTIFACTS_MAX_LIMIT,
  NcListArtifactsResultSchema,
  NcGetArtifactResultSchema,
  artifactFilterKey,
  buildListArtifactsInput,
  makeNcArtifactsClient,
  NcDeleteArtifactResultSchema,
  nextArtifactsPageParam,
  resolveArtifactThumb,
  resolveArtifactUrl,
  siblingArtifactPath,
  toArtifactsPage,
  type NcArtifactRecord,
} from '../nc-artifacts.js'

const READ = '/addon/pipeline-analytics/nc-artifact-read'

function record(over: Partial<NcArtifactRecord> = {}): NcArtifactRecord {
  return {
    id: 'a1',
    kind: 'summary-mosaic',
    mediaType: 'image',
    mime: 'image/jpeg',
    sizeBytes: 12_345,
    createdAt: 1_000,
    capturedAt: 900,
    expiresAt: 9_000,
    deviceId: 102,
    deviceIds: [102],
    downloadPath: `${READ}/a1`,
    ...over,
  }
}

describe('buildListArtifactsInput — filters → wire input', () => {
  it('sends only limit + offset when nothing is narrowed', () => {
    expect(buildListArtifactsInput({}, { limit: 50, offset: 0 })).toEqual({ limit: 50, offset: 0 })
  })

  it('OMITS an empty kinds list instead of sending []', () => {
    // `kinds: []` reads on the server as "none of the kinds" — a gallery that
    // can only ever be empty. "No chip selected" is NO filter.
    const input = buildListArtifactsInput({ kinds: [], deviceIds: [] }, { limit: 50, offset: 0 })
    expect(input).not.toHaveProperty('kinds')
    expect(input).not.toHaveProperty('deviceIds')
  })

  it('passes through the narrowing fields verbatim', () => {
    expect(
      buildListArtifactsInput(
        { kinds: ['timelapse', 'timelapse-preview'], deviceIds: [101, 102], ruleId: 'r1', fromMs: 10, toMs: 20 },
        { limit: 25, offset: 25 },
      ),
    ).toEqual({
      kinds: ['timelapse', 'timelapse-preview'],
      deviceIds: [101, 102],
      ruleId: 'r1',
      fromMs: 10,
      toMs: 20,
      limit: 25,
      offset: 25,
    })
  })

  it('drops an empty ruleId', () => {
    expect(buildListArtifactsInput({ ruleId: '' }, { limit: 10, offset: 0 })).not.toHaveProperty('ruleId')
  })

  it('clamps limit to the server ceiling rather than letting the call be rejected', () => {
    expect(buildListArtifactsInput({}, { limit: 5_000, offset: 0 }).limit).toBe(NC_ARTIFACTS_MAX_LIMIT)
    expect(buildListArtifactsInput({}, { limit: 0, offset: -5 })).toEqual({ limit: 1, offset: 0 })
  })
})

describe('artifactFilterKey', () => {
  it('is order-insensitive so a re-ordered selection is not a new query', () => {
    expect(artifactFilterKey({ kinds: ['timelapse-preview', 'timelapse'], deviceIds: [102, 101] })).toBe(
      artifactFilterKey({ kinds: ['timelapse', 'timelapse-preview'], deviceIds: [101, 102] }),
    )
  })

  it('separates different filter sets', () => {
    expect(artifactFilterKey({ kinds: ['timelapse'] })).not.toBe(artifactFilterKey({ kinds: ['timelapse-preview'] }))
    expect(artifactFilterKey({ fromMs: 1 })).not.toBe(artifactFilterKey({ fromMs: 2 }))
  })
})

describe('NcListArtifactsResultSchema — parsed PER ROW', () => {
  it('drops a row this build cannot decode instead of emptying the gallery', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const parsed = NcListArtifactsResultSchema.parse({
      artifacts: [record(), { id: 'bad', kind: 'holograph' }, record({ id: 'a2' })],
      total: 3,
      hasMore: false,
    })
    expect(parsed.artifacts.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('keeps total/hasMore from the SERVER, not from the surviving rows', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const parsed = NcListArtifactsResultSchema.parse({
      artifacts: [{ id: 'bad' }],
      total: 412,
      hasMore: true,
    })
    expect(parsed.artifacts).toHaveLength(0)
    expect(parsed.total).toBe(412)
    expect(parsed.hasMore).toBe(true)
    warn.mockRestore()
  })

  it('accepts event-clip / event-gif / event-still as first-class kinds', () => {
    const parsed = NcListArtifactsResultSchema.parse({
      artifacts: [
        record({ kind: 'event-clip', mediaType: 'video', mime: 'video/mp4' }),
        record({ kind: 'event-gif', mediaType: 'gif', mime: 'image/gif' }),
        record({ kind: 'event-still', mediaType: 'image', mime: 'image/jpeg' }),
      ],
      total: 3,
      hasMore: false,
    })
    expect(parsed.artifacts.map((a) => a.kind)).toEqual(['event-clip', 'event-gif', 'event-still'])
  })

  it('accepts a cluster-wide artifact with a null primary device', () => {
    const parsed = NcListArtifactsResultSchema.parse({
      artifacts: [record({ kind: 'summary-mosaic', deviceId: null, deviceIds: [101, 102] })],
      total: 1,
      hasMore: false,
    })
    expect(parsed.artifacts[0].deviceId).toBeNull()
  })

  it('parses a null artifact from getArtifact as a real answer', () => {
    expect(NcGetArtifactResultSchema.parse({ artifact: null }).artifact).toBeNull()
  })
})

describe('pagination', () => {
  it('advances by the REQUESTED limit, not by the rows that survived the parse', () => {
    // Rows dropped by the per-row parse would otherwise make the next page
    // re-request what was already served, repeating a row per skipped one.
    const page = toArtifactsPage(
      { artifacts: [record()], total: 200, hasMore: true },
      { limit: 50, offset: 50 },
    )
    expect(page.nextOffset).toBe(100)
    expect(nextArtifactsPageParam(page)).toBe(100)
  })

  it('stops when the server says there is no more', () => {
    const page = toArtifactsPage({ artifacts: [], total: 1, hasMore: false }, { limit: 50, offset: 0 })
    expect(nextArtifactsPageParam(page)).toBeUndefined()
  })
})

describe('resolveArtifactUrl — the authenticated data plane', () => {
  it('prefixes the connected hub base onto the relative downloadPath', () => {
    expect(resolveArtifactUrl('https://hub:4443', `${READ}/a1`)).toBe(`https://hub:4443${READ}/a1`)
  })

  it('strips trailing slashes from the base', () => {
    expect(resolveArtifactUrl('https://hub:4443//', `${READ}/a1`)).toBe(`https://hub:4443${READ}/a1`)
  })

  it('joins a path that arrives without a leading slash', () => {
    expect(resolveArtifactUrl('https://hub:4443', 'addon/x/a1')).toBe('https://hub:4443/addon/x/a1')
  })

  it('passes an already-absolute URL through untouched', () => {
    expect(resolveArtifactUrl('https://hub:4443', 'https://cdn/x.mp4')).toBe('https://cdn/x.mp4')
    expect(resolveArtifactUrl(null, 'http://cdn/x.mp4')).toBe('http://cdn/x.mp4')
  })

  it('returns null with no hub to resolve against', () => {
    expect(resolveArtifactUrl(null, `${READ}/a1`)).toBeNull()
    expect(resolveArtifactUrl('', `${READ}/a1`)).toBeNull()
  })
})

describe('siblingArtifactPath', () => {
  it('swaps the last segment for the sibling id', () => {
    expect(siblingArtifactPath(`${READ}/a1`, 'poster-9')).toBe(`${READ}/poster-9`)
  })

  it('drops a query tail belonging to the original record', () => {
    expect(siblingArtifactPath(`${READ}/a1?variant=x`, 'poster-9')).toBe(`${READ}/poster-9`)
  })

  it('refuses an empty id or a path with no segments', () => {
    expect(siblingArtifactPath(`${READ}/a1`, '')).toBeNull()
    expect(siblingArtifactPath('a1', 'poster-9')).toBeNull()
  })
})

describe('resolveArtifactThumb', () => {
  it('renders an image artifact from its own bytes', () => {
    expect(resolveArtifactThumb(record(), 'https://hub')).toEqual({
      kind: 'image',
      url: `https://hub${READ}/a1`,
    })
  })

  it('renders a gif from its own bytes (it is already a picture)', () => {
    const gif = record({ kind: 'timelapse-preview', mediaType: 'gif', downloadPath: `${READ}/g1` })
    expect(resolveArtifactThumb(gif, 'https://hub')).toEqual({
      kind: 'image',
      url: `https://hub${READ}/g1`,
    })
  })

  it('renders a video from its poster companion still', () => {
    const video = record({
      kind: 'timelapse',
      mediaType: 'video',
      downloadPath: `${READ}/v1`,
      posterArtifactId: 'p1',
    })
    expect(resolveArtifactThumb(video, 'https://hub')).toEqual({
      kind: 'image',
      url: `https://hub${READ}/p1`,
    })
  })

  it('falls back to a placeholder for a video with no poster', () => {
    const video = record({ kind: 'timelapse', mediaType: 'video', downloadPath: `${READ}/v1` })
    expect(resolveArtifactThumb(video, 'https://hub')).toEqual({ kind: 'placeholder' })
  })

  it('falls back to a placeholder with no connected hub', () => {
    expect(resolveArtifactThumb(record(), null)).toEqual({ kind: 'placeholder' })
  })
})

describe('makeNcArtifactsClient — the addons.custom bridge', () => {
  it('routes listArtifacts to pipeline-analytics with the built input', async () => {
    const mutate = vi.fn().mockResolvedValue({ artifacts: [], total: 0, hasMore: false })
    const client = makeNcArtifactsClient({ addonsCustomMutate: mutate })
    await client.listArtifacts(buildListArtifactsInput({ kinds: ['timelapse'] }, { limit: 50, offset: 0 }))
    expect(mutate).toHaveBeenCalledWith({
      addonId: 'pipeline-analytics',
      action: 'nc.listArtifacts',
      input: { kinds: ['timelapse'], limit: 50, offset: 0 },
    })
  })

  it('routes getArtifact by id', async () => {
    const mutate = vi.fn().mockResolvedValue({ artifact: null })
    const client = makeNcArtifactsClient({ addonsCustomMutate: mutate })
    await expect(client.getArtifact('a1')).resolves.toEqual({ artifact: null })
    expect(mutate).toHaveBeenCalledWith({
      addonId: 'pipeline-analytics',
      action: 'nc.getArtifact',
      input: { artifactId: 'a1' },
    })
  })

  it('routes deleteArtifact by id, and answers with every id the hub removed', async () => {
    // A video artifact takes its POSTER with it, so one card can remove two
    // rows — the caller must be told both or the poster's cached row outlives
    // the bytes it points at.
    const mutate = vi.fn().mockResolvedValue({ deleted: true, removedIds: ['a1', 'a1-poster'] })
    const client = makeNcArtifactsClient({ addonsCustomMutate: mutate })
    await expect(client.deleteArtifact('a1')).resolves.toEqual({
      deleted: true,
      removedIds: ['a1', 'a1-poster'],
    })
    expect(mutate).toHaveBeenCalledWith({
      addonId: 'pipeline-analytics',
      action: 'nc.deleteArtifact',
      input: { artifactId: 'a1' },
    })
  })

  it('carries a refusal through as `deleted: false` — never as a throw', () => {
    // `deleted: false` is the hub's ONE answer to unknown / expired / not
    // yours / global-and-you-are-not-admin. It is a fact about the row, not a
    // transport failure, so it must parse cleanly and reach the caller.
    expect(NcDeleteArtifactResultSchema.parse({ deleted: false, removedIds: [] })).toEqual({
      deleted: false,
      removedIds: [],
    })
  })

  it('throws on a malformed delete payload rather than reporting a phantom success', async () => {
    const mutate = vi.fn().mockResolvedValue({ ok: true })
    const client = makeNcArtifactsClient({ addonsCustomMutate: mutate })
    await expect(client.deleteArtifact('a1')).rejects.toThrow()
  })

  it('throws on a malformed payload rather than surfacing an empty gallery', async () => {
    const mutate = vi.fn().mockResolvedValue({ nope: true })
    const client = makeNcArtifactsClient({ addonsCustomMutate: mutate })
    await expect(client.listArtifacts({ limit: 1, offset: 0 })).rejects.toThrow()
  })
})
