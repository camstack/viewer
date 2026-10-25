/**
 * Adding a camera to the wall must leave the OTHERS alone.
 *
 * "Alone" means their component was never unmounted: a `GridTilePlayer` that
 * remounts recreates its `<video>` and its WebRTC peer, which on screen is the
 * camera nobody touched going black and renegotiating. That is the second half
 * of the operator's request — the first (`grid-devices-hot-swap.spec.ts` on the
 * host) only stops the whole DOCUMENT from reloading.
 *
 * Counted with a probe that increments on mount, because the claim is about
 * lifecycle and not about output: a remounted tile renders the same pixels.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useEffect } from 'react'
import { resolveWall } from '../../embed/grid-layout'
import { GridWallSurface } from '../GridWallSurface'

afterEach(cleanup)

const mounts = new Map<number, number>()

beforeEach(() => mounts.clear())

function Tile({ deviceId }: { readonly deviceId: number }) {
  useEffect(() => {
    mounts.set(deviceId, (mounts.get(deviceId) ?? 0) + 1)
  }, [deviceId])
  return <span data-testid={`tile-${deviceId}`}>{deviceId}</span>
}

function wall(devices: readonly number[]) {
  return (
    <GridWallSurface
      wall={resolveWall(devices, 1194, 700, 'auto')}
      renderTile={(deviceId) => <Tile deviceId={deviceId} />}
    />
  )
}

describe('a camera joining the wall', () => {
  it('does not remount the cameras already on it', () => {
    const view = render(wall([101, 102, 621]))
    expect([...mounts.values()]).toEqual([1, 1, 1])

    view.rerender(wall([101, 102, 621, 623]))

    expect(mounts.get(101)).toBe(1)
    expect(mounts.get(102)).toBe(1)
    expect(mounts.get(621)).toBe(1)
    expect(mounts.get(623)).toBe(1)
  })

  it('survives the column count changing under it', () => {
    // The case nested rows could not survive: 3 cameras in one row of 3, then 4
    // in two rows of 2 — camera 621 changes row, and with a row per parent that
    // is an unmount.
    const view = render(
      <GridWallSurface
        wall={resolveWall([101, 102, 621], 1200, 200, 'auto')}
        renderTile={(deviceId) => <Tile deviceId={deviceId} />}
      />,
    )
    view.rerender(
      <GridWallSurface
        wall={resolveWall([101, 102, 621, 623], 700, 700, 'auto')}
        renderTile={(deviceId) => <Tile deviceId={deviceId} />}
      />,
    )
    expect(mounts.get(621)).toBe(1)
  })

  it('does not remount the survivors when a camera LEAVES', () => {
    const view = render(wall([101, 102, 621]))
    view.rerender(wall([101, 621]))
    expect(mounts.get(101)).toBe(1)
    expect(mounts.get(621)).toBe(1)
    expect(view.queryByTestId('tile-102')).toBeNull()
  })

  it('keeps every tile addressable by device id for the host layout report', () => {
    const view = render(wall([101, 102]))
    const cells = view.container.querySelectorAll('[data-device-id]')
    expect([...cells].map((c) => c.getAttribute('data-device-id'))).toEqual(['101', '102'])
  })
})

describe('a camera RESIZED on the wall', () => {
  it('does not remount anybody — the wall reflows, it does not restart', () => {
    // The other half of the operator's request. A resize changes every cell's
    // rect, and a structure that keyed cells by position (or nested them in
    // rows) would tear a peer down for a drag on a different camera.
    const view = render(
      <GridWallSurface
        wall={resolveWall([101, 102, 621], 1194, 700, 'auto')}
        renderTile={(deviceId) => <Tile deviceId={deviceId} />}
      />,
    )
    view.rerender(
      <GridWallSurface
        wall={resolveWall([101, 102, 621], 1194, 700, 'auto', { '101': { cw: 2, ch: 1 } })}
        renderTile={(deviceId) => <Tile deviceId={deviceId} />}
      />,
    )
    expect(mounts.get(101)).toBe(1)
    expect(mounts.get(102)).toBe(1)
    expect(mounts.get(621)).toBe(1)
  })

  it('gives the resized cell a rect that is not the others’, and no crop of it', () => {
    const view = render(
      <GridWallSurface
        wall={resolveWall([101, 102, 621], 1194, 700, 'auto', { '101': { cw: 2, ch: 1 } })}
        renderTile={(deviceId) => <Tile deviceId={deviceId} />}
      />,
    )
    const cell = (id: number) =>
      view.container.querySelector<HTMLElement>(`[data-device-id="${id}"]`)!
    expect(parseFloat(cell(101).style.width)).toBeGreaterThan(parseFloat(cell(102).style.width))
  })
})
