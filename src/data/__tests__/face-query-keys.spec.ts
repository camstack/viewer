/**
 * The guard behind `face-query-keys.ts`.
 *
 * The 2026-09-01 defect was not a wrong invalidation — it was a query key the
 * invalidation had never heard of. `face-review-analyze-pool` and
 * `face-review-clusters` were declared privately inside `use-face-review.ts`,
 * `useAssignFaces` invalidated `track-face` + `face-identities`, and the two
 * lists simply never met: assigned groups came back intact, and no button the
 * operator could press could make either query ask the hub again.
 *
 * So the rule is structural, and this file is what enforces it: a face query
 * key is DECLARED in `face-query-keys.ts` and nowhere else, which is the only
 * way `FACE_ASSIGNMENT_QUERY_KEYS` can be trusted to be complete. A new face
 * query that invents its own literal is the same bug again.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ANALYZE_POOL_KEY,
  FACE_ASSIGNMENT_QUERY_KEYS,
  FACE_ASSIGNMENT_IMMEDIATE_KEYS,
  FACE_ASSIGNMENT_DEFERRED_KEYS,
  __setFaceInvalidationTimerForTest,
  invalidateFaceAssignmentQueries,
  FACE_CLUSTERS_KEY,
  FACE_REVIEW_FACES_KEY,
  IDENTITIES_KEY,
  TRACK_FACE_KEY,
} from '../face-query-keys.js'

/** Every module that queries face state. A new one belongs in this list. */
const FACE_DATA_MODULES: readonly string[] = [
  'src/data/use-face-gallery.ts',
  'src/data/use-face-review.ts',
]

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), 'utf8')
}

describe('the invalidation covers every query an assignment changes', () => {
  it('lists the modal pool and the clusters, not just the two the write used to touch', () => {
    expect(FACE_ASSIGNMENT_QUERY_KEYS).toContain(ANALYZE_POOL_KEY)
    expect(FACE_ASSIGNMENT_QUERY_KEYS).toContain(FACE_CLUSTERS_KEY)
    expect(FACE_ASSIGNMENT_QUERY_KEYS).toContain(FACE_REVIEW_FACES_KEY)
    expect(FACE_ASSIGNMENT_QUERY_KEYS).toContain(TRACK_FACE_KEY)
    expect(FACE_ASSIGNMENT_QUERY_KEYS).toContain(IDENTITIES_KEY)
  })

  it('has no duplicate keys — one name, one query', () => {
    expect(new Set(FACE_ASSIGNMENT_QUERY_KEYS).size).toBe(FACE_ASSIGNMENT_QUERY_KEYS.length)
  })
})

describe('a face query key is declared in ONE place', () => {
  // ⚠ LOAD-BEARING. A `queryKey: ['v2', 'face-whatever']` written inline is a
  // key the invalidation cannot see, and it will look exactly like the hub
  // ignoring the write.
  it('no face data module writes a query-key string inline', () => {
    for (const relative of FACE_DATA_MODULES) {
      const inlineKeys = [...read(relative).matchAll(/queryKey:\s*\[\s*'v2'\s*,\s*'/g)]
      expect({ module: relative, inlineKeys: inlineKeys.length }).toEqual({
        module: relative,
        inlineKeys: 0,
      })
    }
  })

  it('every assignment write goes through the shared invalidation', () => {
    const gallery = read('src/data/use-face-gallery.ts')
    // The mutations that change "is this face assigned, and to whom".
    for (const hook of [
      'useAssignFace',
      'useUnassignFace',
      'useUnassignAllForIdentity',
      'useAssignFaces',
    ]) {
      expect(gallery).toContain(`export function ${hook}(`)
    }
    // Four writes, four shared invalidations — `createIdentity` adds a person
    // without touching a face and keeps its identities-only one.
    //
    // TWO shapes since D434, and which one a write uses is the point: a
    // single-face mutation is a BURST (defer the gallery lists, the operator
    // is still working), a many-faces-in-one-call mutation is not (the list IS
    // the surface, and the Analyze modal's group must vanish at once).
    const burst = [...gallery.matchAll(/await invalidateFaceAssignmentQueries\(queryClient\)/g)]
    const now = [...gallery.matchAll(/await invalidateFaceAssignmentQueriesNow\(queryClient\)/g)]
    expect(burst).toHaveLength(2)
    expect(now).toHaveLength(2)
    expect(burst.length + now.length).toBe(4)
  })
})

/**
 * The WRITE must not wait on the screens behind it.
 *
 * `FaceAssignSheet` documents the symptom in its own header: "every mutation
 * here is a multi-second round trip (the write, two query invalidations AND an
 * embed reload ride `mutateAsync` before it resolves)". The mitigation shipped
 * for that was a spinner — which explains the wait without removing it, and on
 * 2026-09-10 the operator reported assignment from the viewer as blocked.
 *
 * Five keys were invalidated and AWAITED per assignment. Four of them are
 * gallery-wide lists the operator is not looking at while assigning; one is
 * what the open sheet shows. Only that one has to land before the write
 * resolves.
 */
describe('the assignment invalidation is split by who is waiting for it', () => {
  it('the open sheet’s own query is immediate', () => {
    expect(FACE_ASSIGNMENT_IMMEDIATE_KEYS).toContain(TRACK_FACE_KEY)
  })

  it('the gallery-wide lists are deferred, not dropped', () => {
    // Deferred is not "skipped": every key still lands, after the burst.
    expect([...FACE_ASSIGNMENT_IMMEDIATE_KEYS, ...FACE_ASSIGNMENT_DEFERRED_KEYS].sort()).toEqual(
      [...FACE_ASSIGNMENT_QUERY_KEYS].sort(),
    )
  })

  it('nothing is in both halves', () => {
    const immediate = new Set(FACE_ASSIGNMENT_IMMEDIATE_KEYS)
    expect(FACE_ASSIGNMENT_DEFERRED_KEYS.filter((k) => immediate.has(k))).toEqual([])
  })

  it('the deferred half is the expensive one — the lists, not the lookup', () => {
    // Named explicitly so adding a sixth key forces the author to decide which
    // half it belongs to instead of defaulting into the awaited path.
    expect([...FACE_ASSIGNMENT_DEFERRED_KEYS].sort()).toEqual(
      [IDENTITIES_KEY, FACE_REVIEW_FACES_KEY, ANALYZE_POOL_KEY, FACE_CLUSTERS_KEY].sort(),
    )
  })
})

describe('the deferred half actually lands', () => {
  it('refetches every deferred key once, after the burst stops', async () => {
    const pending: (() => void)[] = []
    __setFaceInvalidationTimerForTest(
      (fn) => {
        pending.push(fn)
        return 0 as unknown as ReturnType<typeof setTimeout>
      },
      () => {
        pending.pop()
      },
    )
    const invalidated: string[] = []
    const fake = {
      invalidateQueries: async ({ queryKey }: { queryKey: readonly string[] }): Promise<void> => {
        invalidated.push(String(queryKey[1]))
      },
    } as unknown as Parameters<typeof invalidateFaceAssignmentQueries>[0]

    // Three assignments in a burst.
    await invalidateFaceAssignmentQueries(fake)
    await invalidateFaceAssignmentQueries(fake)
    await invalidateFaceAssignmentQueries(fake)

    // The write waited only for the sheet's own query, three times.
    expect(invalidated).toEqual([TRACK_FACE_KEY, TRACK_FACE_KEY, TRACK_FACE_KEY])
    // One timer, not three.
    expect(pending.length).toBe(1)

    pending[pending.length - 1]?.()
    await Promise.resolve()
    expect(
      invalidated.slice(3).sort(),
      'the gallery lists never refetched — deferred became dropped',
    ).toEqual([...FACE_ASSIGNMENT_DEFERRED_KEYS].sort())

    __setFaceInvalidationTimerForTest(setTimeout, clearTimeout)
  })
})
