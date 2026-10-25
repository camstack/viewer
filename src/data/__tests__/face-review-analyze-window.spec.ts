/**
 * The Analyze ("similar groups") modal asks TWO questions of the hub, and they
 * have to be asked about the SAME faces.
 *
 * ## The operator's report (2026-09-13)
 *
 * *"assicuriamoci che il check … calcoli effettivamente gli ultimi non
 * assegnati, sembra che dopo il primo batch non mostra più niente"* — the
 * modal finds groups the first time and nothing on every pass after it.
 *
 * ## What was actually happening — no cursor is involved
 *
 * There is no paging here at all. Two independent windows were:
 *
 *  - the POOL: `listRecentFaces { filter:'unassigned', limit: 100 }` — the
 *    newest 100 unassigned faces, which is all the modal holds metadata (and
 *    therefore crops) for;
 *  - the CLUSTERING: `suggestFaceClusters`, which the hub runs over
 *    `maxFacesScanned` unassigned faces — default 1 000 (`FACE_SWEEP_PAGE`),
 *    ten times the pool.
 *
 * `restrictClustersToPool` then drops every group left with fewer than
 * `minClusterSize` members INSIDE the pool. So a real pair whose two faces sit
 * either side of the 100-face boundary is computed by the hub, discarded here,
 * and never offered again — and after the first batch the faces that remain in
 * the newest 100 are precisely the ones whose look-alikes are further back.
 * The modal goes quiet while the hub still has groups to give.
 *
 * ## The rule
 *
 * One window. The pool the modal fetches IS the horizon the hub clusters, sent
 * explicitly rather than left to a server default that can move underneath it.
 * `restrictClustersToPool` stays — it still keeps a member the operator cannot
 * see from being silently adoptable — but with the windows aligned it has
 * nothing left to cut, which is the point.
 */
import { describe, expect, it } from 'vitest'

import {
  ANALYZE_CLUSTER_QUERY,
  ANALYZE_POOL_SIZE,
} from '../use-face-review.js'
import { restrictClustersToPool, type FaceCluster } from '../face-cluster-review.js'

const MIN_CLUSTER_SIZE = 2

function cluster(faceIds: readonly string[]): FaceCluster {
  return {
    faceIds,
    representativeFaceId: faceIds[0] as string,
    size: faceIds.length,
    cohesion: 0.8,
  }
}

describe('the pool and the clustering horizon are ONE window', () => {
  // ⚠ LOAD-BEARING. Two numbers that mean "how far back do we look" WILL drift,
  // and the drift is invisible: the modal simply shows fewer groups.
  it('asks the hub to cluster exactly the faces the pool holds', () => {
    expect(ANALYZE_CLUSTER_QUERY.maxFacesScanned).toBe(ANALYZE_POOL_SIZE)
  })

  // The client cannot narrow the sweep any other way: `maxClusters` cuts the
  // RESULT, not the scan. Sending the pool size is the only honest bound.
  it('does not try to bound the sweep with a result cap', () => {
    expect('limit' in ANALYZE_CLUSTER_QUERY).toBe(false)
    expect('maxClusters' in ANALYZE_CLUSTER_QUERY).toBe(false)
  })
})

describe('what a mismatched window did', () => {
  // The mechanism, stated as a value so it cannot be argued about: a genuine
  // pair straddling the pool boundary disappears entirely.
  it('drops a real group whose second member falls outside the pool', () => {
    const pool = new Set(['a'])
    expect(restrictClustersToPool([cluster(['a', 'b'])], pool, MIN_CLUSTER_SIZE)).toHaveLength(0)
  })

  it('keeps the very same group once both members are in the window', () => {
    const pool = new Set(['a', 'b'])
    const kept = restrictClustersToPool([cluster(['a', 'b'])], pool, MIN_CLUSTER_SIZE)
    expect(kept).toHaveLength(1)
    expect(kept[0]?.faceIds).toEqual(['a', 'b'])
  })
})
