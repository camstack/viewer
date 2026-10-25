import { describe, it, expect } from 'vitest'
import {
  parseClipSources,
  resolveClipProvider,
  CLIP_PROVIDER_CAMSTACK_SOURCE,
  clipSourcePickerOptions,
  type ClipSourceRow,
} from '../clip-sources.js'

/**
 * Rows exactly as `videoclips.listSources({deviceId:107})` answered on the live
 * hub, 2026-09-20 — two sources, one CamStack, one onboard, both `ok`.
 */
const LIVE_592: readonly unknown[] = [
  { source: 'analytics', addonId: 'recorder', label: 'CamStack recordings', availability: { state: 'ok' } },
  {
    source: 'native:reolink:onboard',
    addonId: 'provider-reolink',
    label: 'Camera storage',
    availability: { state: 'ok', catalogAsOf: 1789933624463 },
  },
]

function rows(raw: unknown = LIVE_592): readonly ClipSourceRow[] {
  return parseClipSources(raw)
}

describe('parseClipSources', () => {
  it('reads the live rows, carrying the addon that serves each source', () => {
    const parsed = rows()
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({
      sourceId: 'analytics',
      addonId: 'recorder',
      label: 'CamStack recordings',
      state: 'ok',
    })
    expect(parsed[1]).toMatchObject({
      sourceId: 'native:reolink:onboard',
      addonId: 'provider-reolink',
      state: 'ok',
      catalogAsOf: 1789933624463,
    })
  })

  it('keeps a source that cannot answer, with its verbatim reason', () => {
    const parsed = rows([
      {
        source: 'native:reolink:onboard',
        addonId: 'provider-reolink',
        label: 'Camera storage',
        availability: { state: 'index-empty', reason: 'calendar marks 3–20 September, index lists none' },
      },
    ])
    expect(parsed[0]?.state).toBe('index-empty')
    expect(parsed[0]?.reason).toBe('calendar marks 3–20 September, index lists none')
  })

  it('does NOT invent `ok` for a state this build has never seen', () => {
    // D561: `ok` is never a default. A row whose state the build cannot read is
    // `unknown` — which is the truth, and which the surface renders as such.
    const parsed = rows([
      { source: 'x', addonId: 'a', label: 'X', availability: { state: 'quantum-superposition' } },
    ])
    expect(parsed[0]?.state).toBe('unknown')
  })

  it('drops a row with no addon to ask — it can never be selected', () => {
    // `listClips` takes an ADDON id. A row that names no addon is a row the
    // picker could offer and then never satisfy.
    expect(rows([{ source: 'analytics', label: 'CamStack', availability: { state: 'ok' } }])).toHaveLength(0)
  })

  it('answers [] for anything that is not a list', () => {
    expect(rows(null)).toEqual([])
    expect(rows({ sources: [] })).toEqual([])
  })
})

describe('resolveClipProvider — no choice made yet', () => {
  it('defaults to CamStack and keeps the DERIVED clips', () => {
    // The operator: "di default va su camstack". Absence must reproduce exactly
    // what the app drew before this setting existed — the timeline's own
    // clusters ∩ availability — not a cap read nobody asked for.
    //
    // The onboard row is FIRST on purpose: "the default is CamStack" and "the
    // default is whatever the hub listed first" agree on the live ordering, and
    // a test that cannot tell them apart proves neither.
    const choice = resolveClipProvider({ sources: rows([LIVE_592[1], LIVE_592[0]]) })
    expect(choice.sourceId).toBe(CLIP_PROVIDER_CAMSTACK_SOURCE)
    expect(choice.addonId).toBe('recorder')
    expect(choice.derivation).toBe('derived')
    expect(choice.chosenMissing).toBe(false)
  })

  it('does not ask the cap while the sources have not answered', () => {
    // An unanswered query is not an answer (D315). Before `listSources` lands,
    // the body keeps drawing what it drew — never a blank screen.
    const choice = resolveClipProvider({ sources: [] })
    expect(choice.addonId).toBeNull()
    expect(choice.derivation).toBe('derived')
  })

  it('falls to the camera’s only source when it has no CamStack row', () => {
    // A camera with nothing but an onboard catalog must not be told it has no
    // clips — that is the "no clips on a camera full of them" defect (D554 4).
    const choice = resolveClipProvider({
      sources: rows([
        {
          source: 'native:reolink:onboard',
          addonId: 'provider-reolink',
          label: 'Camera storage',
          availability: { state: 'ok' },
        },
      ]),
    })
    expect(choice.addonId).toBe('provider-reolink')
    expect(choice.derivation).toBe('cap')
  })
})

describe('resolveClipProvider — the operator picked one', () => {
  it('asks the picked source, and ONLY it', () => {
    const choice = resolveClipProvider({ chosen: 'native:reolink:onboard', sources: rows() })
    expect(choice.sourceId).toBe('native:reolink:onboard')
    expect(choice.addonId).toBe('provider-reolink')
    expect(choice.derivation).toBe('cap')
  })

  it('picking CamStack back is the derived list again, not a cap read of it', () => {
    // "Non devono avere alcuna connessione": our own recordings reach the clips
    // surface the way they always have. Routing them through `listClips` would
    // restore the SECOND clusterer whose deletion this app already paid for.
    const choice = resolveClipProvider({ chosen: 'analytics', sources: rows() })
    expect(choice.derivation).toBe('derived')
  })

  it('reports a pick the camera no longer has instead of asking for it', () => {
    // `listClips` refuses a provider the device is not bound to BY NAME
    // (D552's rejectUnresolvedAddonPin). Sending it anyway turns a stale
    // preference into a red timeline for ever.
    const choice = resolveClipProvider({ chosen: 'hksv', sources: rows() })
    expect(choice.chosenMissing).toBe(true)
    expect(choice.sourceId).toBe(CLIP_PROVIDER_CAMSTACK_SOURCE)
    expect(choice.derivation).toBe('derived')
  })

  it('a stale pick is not reported while the sources are still unknown', () => {
    // Not-yet-known must never look like not-installed (D315). With no rows in
    // hand there is nothing to contradict the stored pick.
    const choice = resolveClipProvider({ chosen: 'hksv', sources: [] })
    expect(choice.chosenMissing).toBe(false)
  })

  it('honours a source whose state is not ok — the rows say why, the pick stands', () => {
    // A sleeping camera is still the camera the operator chose. Silently
    // swapping him back to CamStack would be the merge D549 rejected, arriving
    // through the picker.
    const choice = resolveClipProvider({
      chosen: 'native:reolink:onboard',
      sources: rows([
        { source: 'analytics', addonId: 'recorder', label: 'CamStack', availability: { state: 'ok' } },
        {
          source: 'native:reolink:onboard',
          addonId: 'provider-reolink',
          label: 'Camera storage',
          availability: { state: 'sleeping', reason: 'standalone battery camera is asleep' },
        },
      ]),
    })
    expect(choice.addonId).toBe('provider-reolink')
    expect(choice.derivation).toBe('cap')
    expect(choice.state).toBe('sleeping')
    expect(choice.reason).toBe('standalone battery camera is asleep')
  })
})

describe('clipSourcePickerOptions', () => {
  it('offers every source the camera HAS, whichever one is being read', () => {
    // A source is never hidden — only its rows (D557). The picker that hides
    // the source you just unpicked is the picker you cannot pick back.
    const options = clipSourcePickerOptions(rows())
    expect(options.map((o) => o.value)).toEqual(['analytics', 'native:reolink:onboard'])
  })

  it('labels a source with the HUB’s own words', () => {
    // `label` is the provider's, and the app has no business paraphrasing it —
    // it is the one string that will still be right when a vendor is added.
    expect(clipSourcePickerOptions(rows())[1]?.label).toBe('Camera storage')
  })

  it('says NOTHING under a source that can answer', () => {
    // A green badge on a working thing is noise; the states exist to explain a
    // list that is short, not to decorate one that is not.
    expect(clipSourcePickerOptions(rows())[0]?.stateKey).toBeNull()
  })

  it('names the state of a source that cannot', () => {
    const options = clipSourcePickerOptions(
      rows([
        {
          source: 'native:reolink:onboard',
          addonId: 'provider-reolink',
          label: 'Camera storage',
          availability: { state: 'no-storage' },
        },
      ]),
    )
    expect(options[0]?.stateKey).toBe('v2.clips.sourceStateNoStorage')
  })

  it('prefers the source’s OWN words to our key when it gave any', () => {
    // D563's rule, at the picker: a client that paraphrases a server's prose
    // drifts the first time a word changes.
    const options = clipSourcePickerOptions(
      rows([
        {
          source: 'native:reolink:onboard',
          addonId: 'provider-reolink',
          label: 'Camera storage',
          availability: { state: 'index-empty', reason: 'calendar marks 3–20 Sep, index lists none' },
        },
      ]),
    )
    expect(options[0]?.detail).toBe('calendar marks 3–20 Sep, index lists none')
    expect(options[0]?.stateKey).toBe('v2.clips.sourceStateIndexEmpty')
  })

  it('offers nothing at all while the camera’s sources are unknown', () => {
    // An empty picker is honest here: it is not "this camera has no sources",
    // it is "nothing has answered", and the surface must not invent a row.
    expect(clipSourcePickerOptions([])).toEqual([])
  })
})
