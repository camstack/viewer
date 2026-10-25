/**
 * CatalogIcon — draws any key of the `@camstack/types` icon catalog (D854).
 *
 * The 1,684 glyphs are DATA (`lib/icon-nodes.generated.ts`, lucide's own icon
 * nodes), not 1,684 imports Metro could not tree-shake. This draws a node with
 * `react-native-svg` using lucide's defaults: 24 viewBox, stroke 2, round caps
 * and joins, no fill, `currentColor` replaced by the theme colour passed in.
 *
 * For the app's own fixed UI glyphs keep importing from `lib/icons.ts`; this is
 * for icon keys an operator picked and the hub stored.
 */
import React, { memo } from 'react'
import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg'

import { ICON_NODES, type IconNode } from '../lib/icon-nodes.generated.js'
import { iconNodeFor } from '../lib/icon-node-for.js'

export interface CatalogIconProps {
  /** A catalog key; an old spelling resolves, an unknown value draws nothing. */
  readonly iconKey: string | null | undefined
  readonly size?: number
  readonly color: string
  readonly strokeWidth?: number
}

const SHAPE = {
  path: Path,
  circle: Circle,
  ellipse: Ellipse,
  line: Line,
  polygon: Polygon,
  polyline: Polyline,
  rect: Rect,
} as const

function drawNode(node: IconNode): React.ReactNode[] {
  return node.map(([tag, attrs], index) => {
    const Shape = SHAPE[tag]
    return <Shape key={index} {...attrs} />
  })
}

export const CatalogIcon = memo(function CatalogIcon({
  iconKey,
  size = 24,
  color,
  strokeWidth = 2,
}: CatalogIconProps): React.JSX.Element | null {
  const node = iconNodeFor(iconKey, ICON_NODES)
  if (node === undefined) return null
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {drawNode(node)}
    </Svg>
  )
})
