/**
 * CardControls — the part of a pressable rule card that holds its own
 * controls (switches, buttons, opt-out toggles). A tap anywhere inside it —
 * on a control or between two — never reaches the card's press, which opens
 * the rule (operator, 2026-10-01: "inner controls must not trigger it").
 *
 * A `Pressable` whose press does nothing, rather than a responder claim: on
 * the web a click BUBBLES through the DOM, and only a press responder stops
 * it (a `Switch` is a plain input there, and its click would otherwise open
 * the editor). On a phone the same wrapper takes the touch first.
 */
import React from 'react'
import { Pressable, type StyleProp, type ViewStyle } from 'react-native'

export interface CardControlsProps {
  readonly children: React.ReactNode
  readonly style?: StyleProp<ViewStyle>
  readonly testID?: string
}

/** The press a control region swallows. */
function swallow(): void {
  // Intentionally nothing: the region exists to keep the press off the card.
}

export function CardControls({ children, style, testID }: CardControlsProps): React.JSX.Element {
  return (
    <Pressable accessible={false} onPress={swallow} style={style} testID={testID}>
      {children}
    </Pressable>
  )
}
