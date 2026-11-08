/**
 * The remote-control glyph (a handheld remote: body, round key, four buttons).
 * Lucide has no icon for it, so it is defined here once; the admin UI draws
 * the SAME nodes. Props behave like a lucide icon's: `size` (24), `color`,
 * `strokeWidth` (2), round caps and joins, 24 viewBox.
 */
import React, { forwardRef } from 'react'
import Svg from 'react-native-svg'
import type { LucideIcon } from './icons.js'

import { drawNode } from '../components/CatalogIcon.js'
import type { IconNode } from './icon-nodes.generated.js'

type LucideProps = React.ComponentPropsWithoutRef<LucideIcon>

export const REMOTE_CONTROL_NODE: IconNode = [
  ['rect', { x: '7', y: '2', width: '10', height: '20', rx: '3' }],
  ['circle', { cx: '12', cy: '8', r: '2.5' }],
  ['path', { d: 'M10 14h.01' }],
  ['path', { d: 'M14 14h.01' }],
  ['path', { d: 'M10 18h.01' }],
  ['path', { d: 'M14 18h.01' }],
]

export const RemoteControl = forwardRef<SVGSVGElement, LucideProps>(function RemoteControl(
  { size = 24, color = 'currentColor', strokeWidth = 2 },
  _ref,
): React.JSX.Element {
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
      {drawNode(REMOTE_CONTROL_NODE)}
    </Svg>
  )
})
