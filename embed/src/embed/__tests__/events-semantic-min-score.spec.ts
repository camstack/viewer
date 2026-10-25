/**
 * The CLIP floor is the SERVER's per-model default unless the operator set one
 * (D649). MobileCLIP's floor is 0.2 and SigLIP2's about 0.1, so a floor this
 * embed invented would be right for one model and empty most of the other's
 * results. What is pinned here is the whole chain: config → URL → request.
 */
import { describe, expect, it } from 'vitest'
import { applyEventsConfigPatch, DEFAULT_EVENTS_FIELDS, eventsConfigPatchSchema, parseEventsConfig } from '../events-config'
import { semanticSearchRequest } from '../../../../shared/events/events-semantic'
import { encodeEventsShareQuery, type EventsShareParams } from '../../../../shared/events/events-share-url'
import { parseEventsUrlConfig } from '../events-url-config'

const ORIGIN = 'https://hub.local:4443'

function configFromUrl(query: string) {
  const result = parseEventsUrlConfig(`?${query}`, '#t=tok', ORIGIN)
  if (result === null || !result.ok) throw new Error(`not a config: ${query}`)
  return result.config
}

describe('semantic search minScore', () => {
  it('a config that never set a score carries none — the parse invents no default', () => {
    const parsed = parseEventsConfig({ serverUrl: ORIGIN, token: 't', fields: DEFAULT_EVENTS_FIELDS })
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.config.semanticMinScore).toBeUndefined()
  })

  it('absent sscore → the request carries NO minScore', () => {
    const config = configFromUrl('mode=events&v=1&view=gallery&thumb=medium&q=red%20car&smode=semantic')
    const request = semanticSearchRequest('red car', [], config)
    expect(request).not.toHaveProperty('minScore')
    expect(request).toEqual({ text: 'red car', limit: 50 })
  })

  it('an explicit sscore in the URL is sent verbatim', () => {
    const config = configFromUrl('mode=events&v=1&view=gallery&thumb=medium&smode=semantic&sscore=0.35')
    expect(semanticSearchRequest('dog', [101], config)).toEqual({
      text: 'dog',
      limit: 50,
      minScore: 0.35,
      deviceId: 101,
    })
  })

  it('an explicit 0 is a real floor, not "unset"', () => {
    const config = configFromUrl('mode=events&v=1&view=gallery&thumb=medium&sscore=0')
    expect(semanticSearchRequest('dog', [], config)).toMatchObject({ minScore: 0 })
  })

  it('a share link carries sscore only when one was set, and it round-trips', () => {
    const base: EventsShareParams = {
      view: 'gallery',
      thumb: 'medium',
      deviceIds: [],
      fields: DEFAULT_EVENTS_FIELDS,
      theme: 'auto',
    }
    expect(encodeEventsShareQuery(base)).not.toContain('sscore=')
    const query = encodeEventsShareQuery({ ...base, semanticMinScore: 0.12 })
    expect(query).toContain('sscore=0.12')
    expect(semanticSearchRequest('cat', [], configFromUrl(query))).toMatchObject({ minScore: 0.12 })
  })

  it('a window rides the request, a multi-camera list does not pin one', () => {
    const config = configFromUrl('mode=events&v=1&view=gallery&thumb=medium&since=1000&until=2000')
    expect(semanticSearchRequest('x', [1, 2], config)).toEqual({ text: 'x', limit: 50, since: 1000, until: 2000 })
  })
})

describe('setConfig can UNSET the score (null), like the window bounds', () => {
  it('null clears it back to absent, undefined keeps it, a number replaces it', () => {
    const set = configFromUrl('mode=events&v=1&view=gallery&thumb=medium&sscore=0.3')
    // The same schema a `setConfig` command is validated with.
    const patch = (raw: unknown) => eventsConfigPatchSchema.parse(raw)
    const cleared = applyEventsConfigPatch(set, patch({ semanticMinScore: null }))
    expect(cleared).not.toHaveProperty('semanticMinScore')
    expect(semanticSearchRequest('dog', [], cleared)).not.toHaveProperty('minScore')
    expect(applyEventsConfigPatch(set, patch({ searchMode: 'semantic' })).semanticMinScore).toBe(0.3)
    expect(applyEventsConfigPatch(set, patch({ semanticMinScore: 0.15 })).semanticMinScore).toBe(0.15)
  })
})
