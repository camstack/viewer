/**
 * IconButtonGroup — several icon-only actions of ONE device, drawn as one
 * capsule: adjacent segments, a hairline between them, the active one filled.
 *
 * A row with two or more actions groups them here instead of strewing round
 * buttons across the row (a light's on/off · dimmer, a cover's up · stop ·
 * down, a media player's transport, an alarm panel's modes). A lone action is
 * not grouped: it stays a single `IconButton`. Every segment is icon-only and
 * carries its old label as `accessibilityLabel`.
 *
 * The group only draws the capsule. The segments are the accessory `IconButton`s
 * (`accessory-controls/control-atoms.tsx`), which read {@link useInIconGroup}
 * and draw as a flat segment when they are inside one — the press, the haptic
 * weight and the "moving" pulse are theirs, and unchanged.
 */
import React, { createContext, useContext } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS } from '../../theme/tokens.js'

/** Side (pt) of one segment: the same 32 pt a lone `IconButton` is. */
export const ICON_SEGMENT_SIZE = 32

const InIconGroupContext = createContext(false)

/** True under an {@link IconButtonGroup}: an `IconButton` then draws as a flat segment. */
export function useInIconGroup(): boolean {
  return useContext(InIconGroupContext)
}

export interface IconButtonGroupProps {
  /** The segments, in order. */
  readonly children: React.ReactNode
  readonly testID?: string
}

export function IconButtonGroup({ children, testID }: IconButtonGroupProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <InIconGroupContext.Provider value>
      <View
        testID={testID}
        accessibilityRole="toolbar"
        style={[styles.capsule, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}
      >
        {/* Shifted one hairline left: each segment draws its own left divider, and the first one's falls outside the clip. */}
        <View style={styles.segments}>{children}</View>
      </View>
    </InIconGroupContext.Provider>
  )
}

const styles = StyleSheet.create({
  capsule: {
    borderRadius: RADIUS.pill,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flexShrink: 0,
  },
  segments: { flexDirection: 'row', alignItems: 'center', marginLeft: -StyleSheet.hairlineWidth },
})
