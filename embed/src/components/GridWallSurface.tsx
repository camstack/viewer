/**
 * The wall: one parent, N absolutely-positioned cells, keyed by device id.
 *
 * Its whole reason to exist is the KEYING and the PARENTING. A tile that stays
 * on the wall across a device-set change must keep its component instance —
 * its `<video>` and its WebRTC peer live there — and the only structure that
 * guarantees that is one stable parent holding every tile as a sibling. The
 * nested rows this replaced re-parented a camera every time the column count
 * moved, so adding one camera renegotiated a peer nobody touched.
 *
 * That property is why this takes a RESOLVED wall (`resolveWall`) rather than a
 * cell size: a resized cell changes where every other cell sits, and if this
 * component still derived the geometry from a uniform `cellW × cellH` it would
 * have to grow a second idea of the wall next to the one that already exists.
 * The geometry arrives whole; this places it.
 *
 * `data-device-id` stays on each cell: the page reports tile rects to the host
 * from those nodes, and the native overlays anchor on them.
 */
import type { ReactNode } from 'react'
import type { WallGeometry } from '../embed/grid-layout'

interface GridWallSurfaceProps {
  /** The block to draw and every camera's rectangle in it. */
  readonly wall: WallGeometry
  /** The cell body. `cellW`/`cellH` are passed on because a tile decides which
   *  of its controls fit — and now how its picture is inscribed — from its own
   *  size, which is no longer the same for every cell. */
  readonly renderTile: (deviceId: number, cellW: number, cellH: number) => ReactNode
}

export function GridWallSurface({ wall, renderTile }: GridWallSurfaceProps) {
  return (
    <div style={{ position: 'relative', width: wall.wallW, height: wall.wallH }}>
      {wall.placements.map((p) => (
        <div
          key={p.deviceId}
          data-device-id={p.deviceId}
          style={{ position: 'absolute', left: p.x, top: p.y, width: p.w, height: p.h }}
        >
          {renderTile(p.deviceId, p.w, p.h)}
        </div>
      ))}
    </div>
  )
}
