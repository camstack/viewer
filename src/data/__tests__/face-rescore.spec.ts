import { describe, expect, it, vi } from 'vitest'
import {
  FaceRescoreReportSchema,
  formatRescoreScore,
  makeFaceRescoreClient,
  rescoreRowTone,
  rescoreVerdictKey,
  rescoreVerdictTone,
  shouldOfferReembed,
  type FaceRescoreReport,
} from '../face-rescore.js'

const BASE: FaceRescoreReport = {
  faceId: 'face-t1',
  deviceId: 102,
  trackId: 't1',
  assigned: false,
  verdict: 'auto-assignable',
  comparable: true,
  probeModelId: 'auraface-r100',
  clusterModelId: 'auraface-r100',
  params: { threshold: 0.45, margin: 0.12, minIdentitySamples: 2, suggestionMinCosine: 0.5 },
  identities: [
    {
      identityId: 'a',
      name: 'Alice',
      score: 0.71,
      sampleCount: 11,
      eligible: true,
      meetsThreshold: true,
      wouldAutoAssign: true,
    },
    {
      identityId: 'b',
      name: 'Bob',
      score: 0.31,
      sampleCount: 6,
      eligible: true,
      meetsThreshold: false,
      wouldAutoAssign: false,
    },
  ],
  reembedAvailable: false,
  reembed: { attempted: false, succeeded: false, reason: 'not-requested' },
}

describe('formatRescoreScore', () => {
  it('renders a cosine as a whole percentage', () => {
    expect(formatRescoreScore(0.71)).toBe('71%')
    expect(formatRescoreScore(0.455)).toBe('46%')
    expect(formatRescoreScore(1)).toBe('100%')
  })

  it('clamps a negative cosine to 0% instead of printing "-12%"', () => {
    // Cosine is signed; a percentage is not. "-12% match" is not a thing the
    // operator can act on and reads as a bug.
    expect(formatRescoreScore(-0.12)).toBe('0%')
  })

  it('clamps above 1 rather than printing 101%', () => {
    expect(formatRescoreScore(1.004)).toBe('100%')
  })

  it('returns null for a non-finite score so the caller renders nothing', () => {
    expect(formatRescoreScore(Number.NaN)).toBeNull()
    expect(formatRescoreScore(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('rescoreRowTone', () => {
  const params = BASE.params

  it('marks the row the pipeline would actually assign', () => {
    expect(rescoreRowTone(BASE.identities[0]!, params)).toBe('would-assign')
  })

  it('marks an above-threshold row that is NOT the winner as contested', () => {
    const row = { ...BASE.identities[1]!, score: 0.68, meetsThreshold: true }
    expect(rescoreRowTone(row, params)).toBe('over-threshold')
  })

  it('marks an ineligible row as blocked, whatever it scored', () => {
    // A 99% row that cannot be assigned must not look assignable.
    const row = {
      ...BASE.identities[1]!,
      score: 0.99,
      meetsThreshold: true,
      eligible: false,
      wouldAutoAssign: false,
    }
    expect(rescoreRowTone(row, params)).toBe('blocked')
  })

  it('marks a suggestion-band row', () => {
    const row = { ...BASE.identities[1]!, score: 0.52, meetsThreshold: false }
    expect(rescoreRowTone(row, { ...params, threshold: 0.6 })).toBe('suggestion')
  })

  it('marks everything else as below', () => {
    expect(rescoreRowTone(BASE.identities[1]!, params)).toBe('below')
  })
})

describe('rescoreVerdictTone / rescoreVerdictKey', () => {
  it('greens only the verdict that would actually assign', () => {
    expect(rescoreVerdictTone('auto-assignable')).toBe('good')
    expect(rescoreVerdictTone('suggestion')).toBe('medium')
    expect(rescoreVerdictTone('ambiguous')).toBe('medium')
    expect(rescoreVerdictTone('below-threshold')).toBe('low')
    expect(rescoreVerdictTone('no-eligible-identity')).toBe('low')
    expect(rescoreVerdictTone('empty-gallery')).toBe('low')
  })

  it('treats model-mismatch as a WARNING, never as a low score', () => {
    // The difference that matters: "no match" vs "this question cannot be
    // answered". Rendering the second as the first is how the operator
    // concludes a person is missing from the gallery when they are not.
    expect(rescoreVerdictTone('model-mismatch')).toBe('warning')
  })

  it('names a distinct i18n key per verdict', () => {
    const keys = (
      [
        'auto-assignable',
        'ambiguous',
        'suggestion',
        'below-threshold',
        'no-eligible-identity',
        'empty-gallery',
        'model-mismatch',
      ] as const
    ).map(rescoreVerdictKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.every((k) => k.startsWith('v2.tracks.rescore.'))).toBe(true)
  })
})

describe('shouldOfferReembed', () => {
  it('offers the re-embed only when the backend says one could work', () => {
    expect(shouldOfferReembed({ ...BASE, verdict: 'model-mismatch', reembedAvailable: true })).toBe(
      true,
    )
  })

  it('does NOT offer it when there are no pixels to re-embed from', () => {
    expect(
      shouldOfferReembed({ ...BASE, verdict: 'model-mismatch', reembedAvailable: false }),
    ).toBe(false)
  })

  it('does not offer it for a face that is already comparable', () => {
    expect(shouldOfferReembed({ ...BASE, reembedAvailable: true })).toBe(false)
  })

  it('does not offer it again once a re-embed already succeeded', () => {
    expect(
      shouldOfferReembed({
        ...BASE,
        verdict: 'model-mismatch',
        reembedAvailable: true,
        reembed: { attempted: true, succeeded: true, modelId: 'auraface-r100' },
      }),
    ).toBe(false)
  })
})

describe('FaceRescoreReportSchema', () => {
  it('parses a full report', () => {
    expect(FaceRescoreReportSchema.parse(BASE)).toEqual(BASE)
  })

  it('rejects a payload missing the params in force', () => {
    const { params: _dropped, ...withoutParams } = BASE
    expect(FaceRescoreReportSchema.safeParse(withoutParams).success).toBe(false)
  })

  it('rejects an unknown verdict rather than rendering it raw', () => {
    expect(FaceRescoreReportSchema.safeParse({ ...BASE, verdict: 'probably' }).success).toBe(false)
  })
})

describe('makeFaceRescoreClient', () => {
  it('calls addons.custom on pipeline-analytics with the rescore action', async () => {
    const addonsCustomMutate = vi.fn().mockResolvedValue(BASE)
    const client = makeFaceRescoreClient({ addonsCustomMutate })
    const out = await client.rescoreTrack({ deviceId: 102, trackId: 't1', reembed: false })
    expect(addonsCustomMutate).toHaveBeenCalledWith({
      addonId: 'pipeline-analytics',
      action: 'face.rescoreTrack',
      input: { deviceId: 102, trackId: 't1', reembed: false },
    })
    expect(out.verdict).toBe('auto-assignable')
  })

  it('never sends reembed implicitly — an omitted flag is sent as false', async () => {
    // A "recompute" that silently spent GPU would be a different button.
    const addonsCustomMutate = vi.fn().mockResolvedValue(BASE)
    const client = makeFaceRescoreClient({ addonsCustomMutate })
    await client.rescoreTrack({ deviceId: 102, trackId: 't1' })
    expect(addonsCustomMutate.mock.calls[0]![0].input).toEqual({
      deviceId: 102,
      trackId: 't1',
      reembed: false,
    })
  })

  it('throws on a malformed reply instead of handing the UI a partial report', async () => {
    const addonsCustomMutate = vi.fn().mockResolvedValue({ verdict: 'auto-assignable' })
    const client = makeFaceRescoreClient({ addonsCustomMutate })
    await expect(client.rescoreTrack({ deviceId: 1, trackId: 't' })).rejects.toThrow()
  })
})
