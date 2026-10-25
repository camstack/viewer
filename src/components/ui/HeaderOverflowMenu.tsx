/**
 * HeaderOverflowMenu — a page's `⋯` header button and the menu it opens.
 *
 * The review pages (People, Plates, later Scenes) keep ONE labelled primary
 * action in the header and put everything else here, each item an icon AND a
 * label: a row of six unlabelled glass discs was a set of glyphs the operator
 * had to learn, and the same glyph meant two different things on two pages.
 * One item id = one meaning on every page that offers it.
 *
 * Usage: `const overflow = useHeaderOverflowMenu(items)`, then put
 * `overflow.action` in the header's actions and render `overflow.menu`.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, type LucideIcon } from '../../lib/icons.js'
import type { HeaderAction } from '../ScreenHeader.js'
import { AnchoredMenu } from './AnchoredMenu.js'
import type { AnchorRect } from './dropdown-placement.js'
import { MenuRow } from './MenuRow.js'

export interface OverflowMenuItem {
  readonly id: string
  readonly icon: LucideIcon
  readonly label: string
  readonly onPress: () => void
  /** Rendered but inert (a job of the same kind is already running). */
  readonly disabled?: boolean
  readonly testID?: string
}

export interface HeaderOverflowMenu {
  readonly action: HeaderAction
  readonly menu: React.JSX.Element
}

/** Height of one `MenuRow`, for placing the menu before it is measured. */
const ROW_ESTIMATE = 48

export function useHeaderOverflowMenu(
  items: readonly OverflowMenuItem[],
  testID = 'header-overflow',
): HeaderOverflowMenu {
  const { t } = useTranslation()
  const ref = useRef<View>(null)
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  const action = useMemo<HeaderAction>(
    () => ({
      id: 'overflow',
      icon: MoreHorizontal,
      label: t('v2.library.moreActions'),
      anchorRef: ref,
      active: open,
      testID,
      onPress: () => {
        ref.current?.measureInWindow((x, y, width, height) => {
          setAnchor({ x, y, width, height })
          setOpen(true)
        })
      },
    }),
    [t, open, testID],
  )

  const menu = (
    <AnchoredMenu
      visible={open}
      onRequestClose={close}
      anchor={anchor}
      align="end"
      minWidth={240}
      estimatedHeight={items.length * ROW_ESTIMATE + 16}
    >
      {items.map((item) => (
        <View key={item.id} style={item.disabled === true ? styles.inert : null} pointerEvents={item.disabled === true ? 'none' : 'auto'}>
          <MenuRow
            icon={item.icon}
            label={item.label}
            testID={item.testID}
            onPress={() => {
              if (item.disabled === true) return
              close()
              item.onPress()
            }}
          />
        </View>
      ))}
    </AnchoredMenu>
  )

  return { action, menu }
}

const styles = StyleSheet.create({ inert: { opacity: 0.4 } })
