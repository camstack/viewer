/**
 * Gesture Handler under jsdom. `Gesture.Pan()` and friends return a chainable
 * recorder: every builder method returns the same object, so a component can
 * configure a gesture exactly as it does in the app without any of it firing.
 *
 * The recorder also KEEPS what it was given. A builder call whose single
 * argument is a function (`onStart`, `onUpdate`, `onEnd`, …) is stored under
 * that name in `__handlers`, and a composer (`Simultaneous`, `Exclusive`,
 * `Race`) keeps its members in `__children` — so a hook test can reach the
 * pinch inside `Gesture.Simultaneous(pinch, pan)` and drive it by hand. Under
 * the stub the callbacks are plain functions; the worklet directive is inert.
 */
import React from 'react'
import { ScrollView, Text, View, type ViewProps } from 'react-native'
import { makeStubView } from './passthrough.js'

export type StubHandler = (...args: never[]) => unknown

export interface StubGesture {
  readonly __stubGesture: true
  /** The last callback registered under each builder name. */
  readonly __handlers: Readonly<Record<string, StubHandler>>
  /** A composer's members, in the order they were given. */
  readonly __children: readonly StubGesture[]
}

function chainable(children: readonly StubGesture[] = []): StubGesture {
  const handlers: Record<string, StubHandler> = {}
  const target: Record<string, unknown> = {
    __stubGesture: true,
    __handlers: handlers,
    __children: children,
  }
  const proxy: StubGesture = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[String(prop)]
      return (...args: unknown[]) => {
        if (args.length === 1 && typeof args[0] === 'function') {
          handlers[String(prop)] = args[0] as StubHandler
        }
        return proxy
      }
    },
  }) as unknown as StubGesture
  return proxy
}

const compose = (...members: StubGesture[]): StubGesture => chainable(members)

export const Gesture = {
  Pan: chainable,
  Pinch: chainable,
  Tap: chainable,
  LongPress: chainable,
  Fling: chainable,
  Native: chainable,
  Manual: chainable,
  Rotation: chainable,
  Simultaneous: compose,
  Race: compose,
  Exclusive: compose,
}

export type GestureType = StubGesture
export type ComposedGesture = StubGesture
export type SimultaneousGesture = StubGesture

export const GestureDetector = ({ children }: ViewProps): React.ReactElement => <View>{children}</View>

export const GestureHandlerRootView = ({ children, style }: ViewProps): React.ReactElement => (
  <View style={style}>{children}</View>
)

export const PanGestureHandler = GestureDetector
export const TapGestureHandler = GestureDetector
export const TouchableOpacity = makeStubView('GH.TouchableOpacity')
export { ScrollView, Text }
export const State = { UNDETERMINED: 0, BEGAN: 2, ACTIVE: 4, END: 5 } as const
