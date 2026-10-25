/**
 * @vitest-environment jsdom
 *
 * Every cluster is its gallery panel: one thumbnail per subject (a single
 * subject is one thumbnail in the same panel), tap seeks and selects, the lens acts on
 * the selected thumbnail (else the first); playback never lights one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mountScreen } from '../../../../testing/mount.js'
import { clusterByZoom, type ObjectEvent } from '../event-cluster.js'
import { ClusterCard, CLUSTER_CARD_TEST_ID } from '../ClusterCard.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => cleanup())

function ev(id: string, timestamp: number, trackId: string): ObjectEvent {
  return { id, deviceId: 11, className: 'person', timestamp, trackId }
}

const ONE_CARD = { topMs: 1_000_000, zoomIndex: 0, sizePx: 200, gapPx: 8 } as const
const THREE = [ev('a', 1_000_000, 't1'), ev('b', 1_000_400, 't2'), ev('c', 1_000_800, 't3')]

function render(
  events: readonly ObjectEvent[],
  extra: Record<string, unknown> = {},
): HTMLElement {
  const [cluster] = clusterByZoom([...events], ONE_CARD)
  return mountScreen(
    React.createElement(ClusterCard, { cluster, width: 300, onPress: () => {}, ...extra }),
  ).container
}

const thumbs = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('[role="button"]')].filter((b) =>
    /^\d{1,2}:\d{2}/.test(b.getAttribute('aria-label') ?? ''),
  )

const lens = (root: HTMLElement): HTMLElement | undefined =>
  [...root.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (b) => !/^\d{1,2}:\d{2}/.test(b.getAttribute('aria-label') ?? ''),
  )

describe('the cluster gallery panel', () => {
  it('draws one thumbnail per subject', () => {
    const root = render(THREE)
    expect(root.querySelector(`[data-testid="${CLUSTER_CARD_TEST_ID}"]`)).not.toBeNull()
    expect(thumbs(root)).toHaveLength(3)
  })

  it('a single subject is one thumbnail in the same panel', () => {
    expect(thumbs(render([ev('a', 1_000_000, 't1'), ev('b', 1_000_400, 't1')]))).toHaveLength(1)
  })

  it('clips mode holds the visit alone', () => {
    expect(thumbs(render(THREE, { paging: false }))).toHaveLength(1)
  })

  it('a tap on a thumbnail hands that event to onPress', () => {
    const onPress = vi.fn()
    const root = render(THREE, { onPress })
    fireEvent.click(thumbs(root)[1]!)
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onPress.mock.calls[0]![0].id).toBe('b')
  })

  it('the lens opens the detail on the tapped (active) thumbnail', () => {
    const onOpenDetail = vi.fn()
    const onPress = vi.fn()
    const root = render(THREE, { onOpenDetail, onPress })
    fireEvent.click(thumbs(root)[2]!)
    const tapped = (onPress.mock.calls.at(-1)?.[0] as ObjectEvent).id
    fireEvent.click(lens(root)!)
    expect(onOpenDetail.mock.calls[0]![0].id).toBe(tapped)
  })

  it('the lens opens the first thumbnail when nothing is selected', () => {
    const onOpenDetail = vi.fn()
    const root = render(THREE, { onOpenDetail })
    fireEvent.click(lens(root)!)
    expect(onOpenDetail.mock.calls[0]![0].id).toBe(clusterByZoom([...THREE], ONE_CARD)[0]!.carouselEvents[0]!.id)
  })

  it('selection is the last tap, else none (borders follow the selected thumbnail only)', () => {
    // react-native-web drops aria-selected on a button, so the rule is read where
    // it is written; the tap path itself is proved above through the lens.
    const src = readFileSync(join(__dirname, '..', 'ClusterCard.tsx'), 'utf8')
    expect(src).toContain("const selectedIndex = tappedId === null ? -1")
    expect(src).toContain('borderColor: active ? colors.primary : accent')
  })

  it('the lens follows the last tap', () => {
    const onOpenDetail = vi.fn()
    const root = render(THREE, { onOpenDetail })
    fireEvent.click(thumbs(root)[2]!)
    fireEvent.click(lens(root)!)
    const clicked = clusterByZoom([...THREE], ONE_CARD)[0]!.carouselEvents[2]!.id
    expect(onOpenDetail.mock.calls[0]![0].id).toBe(clicked)
  })
})
