/**
 * @vitest-environment jsdom
 *
 * How many CAMERAS had events in a cluster.
 *
 * The operator was offered per-camera lanes on the multi-camera timeline and
 * refused them ("le corsie potrebbero essere confuse"): the heatmap and the
 * activity bars stay UNIFIED, and what a card gains instead is a COUNT of the
 * cameras that contributed to it. Not a list of names — a number.
 *
 * Two claims, and both have a wrong obvious form:
 *
 *  1. the count is the TRUE one. `clusterByZoom` groups by time and never reads
 *     `deviceId`, so a card holding three cameras' events must say three — and
 *     a card holding six events of ONE camera must not say six.
 *  2. the card DRAWS it, above one and only above one. A single-camera timeline
 *     — every camera-detail card the theater has ever drawn — is unchanged.
 */
import { describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../../testing/mount.js'
import { clusterByZoom, clusterDeviceIds, type ObjectEvent } from '../event-cluster.js'
import { ClusterCard, CLUSTER_CAMERA_COUNT_TEST_ID } from '../ClusterCard.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

/** A real event, never a partial cast: a fixture that omits a field the subject
 *  reads is how a green test covers a live defect. */
function ev(id: string, deviceId: number, timestamp: number, trackId?: string): ObjectEvent {
  return {
    id,
    deviceId,
    className: 'person',
    timestamp,
    ...(trackId !== undefined ? { trackId } : {}),
  }
}

/** One card's worth of geometry — a card taller than the span the events cover,
 *  so the greedy pass absorbs all of them into a single cluster. */
const ONE_CARD = { topMs: 1_000_000, zoomIndex: 0, sizePx: 200, gapPx: 8 } as const

describe('the count is the cameras that had events, not the events', () => {
  it('three cameras in one cluster count three', () => {
    const clusters = clusterByZoom(
      [
        ev('a', 11, 1_000_000, 't1'),
        ev('b', 22, 1_000_500, 't2'),
        ev('c', 33, 1_001_000, 't3'),
      ],
      ONE_CARD,
    )
    expect(clusters).toHaveLength(1)
    expect(clusterDeviceIds(clusters[0])).toEqual([33, 22, 11])
    expect(clusterDeviceIds(clusters[0])).toHaveLength(3)
  })

  it('six events of ONE camera count one — the count is not the event count', () => {
    const clusters = clusterByZoom(
      [
        ev('a', 11, 1_000_000, 't1'),
        ev('b', 11, 1_000_200, 't2'),
        ev('c', 11, 1_000_400, 't3'),
        ev('d', 11, 1_000_600, 't4'),
        ev('e', 11, 1_000_800, 't5'),
        ev('f', 11, 1_001_000, 't6'),
      ],
      ONE_CARD,
    )
    expect(clusters).toHaveLength(1)
    expect(clusters[0].events).toHaveLength(6)
    expect(clusterDeviceIds(clusters[0])).toEqual([11])
  })

  it('a camera whose only event the CAROUSEL dedupe folded away still counts', () => {
    // `chainUntrackedFragments` chains same-class events on time alone and does
    // not look at the camera, so two untracked `person` events 1 s apart from
    // DIFFERENT cameras collapse to one carousel page. Counting there would
    // report one camera for a group that two cameras contributed to.
    const clusters = clusterByZoom(
      [ev('a', 11, 1_000_000), ev('b', 22, 1_001_000)],
      ONE_CARD,
    )
    expect(clusters).toHaveLength(1)
    expect(clusters[0].carouselEvents).toHaveLength(1)
    expect(clusterDeviceIds(clusters[0])).toHaveLength(2)
  })

  it('cameras are distinct and in the cluster order, never repeated', () => {
    const clusters = clusterByZoom(
      [
        ev('a', 11, 1_000_000, 't1'),
        ev('b', 22, 1_000_300, 't2'),
        ev('c', 11, 1_000_600, 't3'),
        ev('d', 22, 1_000_900, 't4'),
      ],
      ONE_CARD,
    )
    expect(clusterDeviceIds(clusters[0])).toEqual([22, 11])
  })
})

describe('the card draws it', () => {
  function cardFor(events: readonly ObjectEvent[]): HTMLElement {
    const [cluster] = clusterByZoom([...events], ONE_CARD)
    const { container } = mountScreen(
      React.createElement(ClusterCard, { cluster, width: 260, onPress: () => {} }),
    )
    return container
  }

  it('a three-camera cluster shows 3, with the count spelled out for a reader', () => {
    const root = cardFor([
      ev('a', 11, 1_000_000, 't1'),
      ev('b', 22, 1_000_500, 't2'),
      ev('c', 33, 1_001_000, 't3'),
    ])
    const chip = root.querySelector(`[data-testid="${CLUSTER_CAMERA_COUNT_TEST_ID}"]`)
    expect(chip).not.toBeNull()
    expect(chip?.textContent).toBe('3')
    // English off the shipped locale — never a raw i18n key on screen.
    expect(chip?.getAttribute('aria-label')).toBe('3 cameras')
    cleanup()
  })

  it('a single-camera cluster draws no chip at all', () => {
    const root = cardFor([
      ev('a', 11, 1_000_000, 't1'),
      ev('b', 11, 1_000_500, 't2'),
    ])
    // The POSITIVE control first: without it "no chip" also passes on a card
    // that failed to render anything.
    expect(root.querySelector('[data-testid="cluster-card"]')).not.toBeNull()
    expect(root.querySelector(`[data-testid="${CLUSTER_CAMERA_COUNT_TEST_ID}"]`)).toBeNull()
    cleanup()
  })
})
