/**
 * DisplayMenu — the body of every Library page's eye menu (see
 * `display-menu.ts` for the declaration and why it is one thing).
 *
 * One `Section` card per section, its title above it in the kit's
 * `SectionLabel` style; a choice is a `SegmentedControl` at the chips' size,
 * a toggle a `ToggleRow` in its `compact` (menu) scale.
 */
import React, { memo } from 'react'
import { StyleSheet, View } from 'react-native'
import { SPACING } from '../../theme/tokens.js'
import { Section } from './Section.js'
import { SegmentedControl } from './SegmentedControl.js'
import { ToggleRow } from './ToggleRow.js'
import type { DisplayMenuItem, DisplayMenuSection } from './display-menu.js'

export interface DisplayMenuProps {
  readonly sections: readonly DisplayMenuSection[]
  readonly testID?: string
}

function Item({ item, last }: { readonly item: DisplayMenuItem; readonly last: boolean }) {
  if (item.kind === 'toggle') {
    return <ToggleRow label={item.label} value={item.value} onValueChange={item.onChange} last={last} compact />
  }
  return (
    <View style={styles.choice}>
      <SegmentedControl<string> options={item.options} value={item.value} onChange={item.onChange} size="sm" />
    </View>
  )
}

export const DisplayMenu = memo(function DisplayMenu({ sections, testID }: DisplayMenuProps) {
  return (
    <View style={styles.root} testID={testID}>
      {sections.map((section) => (
        <Section key={section.id} title={section.title} testID={`display-menu-${section.id}`}>
          {section.items.map((item, i) => (
            <Item key={item.id} item={item} last={i === section.items.length - 1} />
          ))}
        </Section>
      ))}
    </View>
  )
})

const styles = StyleSheet.create({
  root: { gap: SPACING.md, paddingVertical: SPACING.sm },
  choice: { padding: SPACING.md },
})
