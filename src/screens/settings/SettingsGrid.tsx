/**
 * Lays the settings sections out in columns when the window is wide enough.
 *
 * The page has nine sections. In one column an operator on a tablet or a
 * desktop window scrolls past all of them to reach the last — so above
 * `SETTINGS_TWO_COL_MIN` they wrap into two, and three on a very wide window.
 *
 * ## Why the width comes from a LAYOUT event and not from the screen
 *
 * The sections are laid out inside whatever box this sits in — a sidebar layout
 * gives the page less than the window. Measuring the container is the only
 * answer that stays true when the shell around it changes, and
 * `container-width.ts` documents the latched-measurement defect that comes from
 * measuring once: this re-reads on every layout pass.
 *
 * Below the threshold the children are rendered UNWRAPPED, exactly as before —
 * a single column with no extra view in the tree, so the phone layout is
 * byte-for-byte what shipped.
 */
import { useState, type ReactNode } from 'react'
import { Children, isValidElement } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import { SPACING } from '../../theme/tokens.js'
import { settingsColumns } from './settings-grid.js'

export interface SettingsGridProps {
  readonly children: ReactNode
}

export function SettingsGrid({ children }: SettingsGridProps): React.JSX.Element {
  const [width, setWidth] = useState(0)
  const onLayout = (e: LayoutChangeEvent): void => {
    // A hidden Settings segment (`display: 'none'`) lays out at width 0. Keep
    // the last real width instead, or every switch back would paint one
    // single-column frame before reflowing into columns.
    const next = e.nativeEvent.layout.width
    if (next > 0) setWidth(next)
  }
  const columns = settingsColumns(width)
  // `0` before the first layout pass: render one column rather than guessing a
  // wide one and reflowing under the operator on the very first frame.
  if (columns <= 1) {
    return (
      <View onLayout={onLayout} style={{ gap: SPACING['2xl'] }}>
        {children}
      </View>
    )
  }
  const items = Children.toArray(children).filter(isValidElement)
  return (
    <View
      onLayout={onLayout}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: SPACING['2xl'],
      }}
    >
      {items.map((child, i) => (
        <View
          // The array is a static section list in source order — no ids, and
          // nothing reorders. The index is the identity.
          key={i}
          style={{
            // Minus the gaps between columns, shared out. Without this the last
            // column overflows by exactly `gap × (columns - 1)`.
            width: (width - SPACING['2xl'] * (columns - 1)) / columns,
          }}
        >
          {child}
        </View>
      ))}
    </View>
  )
}
