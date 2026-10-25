/**
 * The one shape most native view wrappers reduce to under test: render the
 * children inside a plain `View` and drop the native-only props. Exported for
 * the per-module stubs rather than duplicated in each.
 *
 * Each stub carries `testID="stub-<name>"` — react-native-web emits it as
 * `data-testid`, so a mount test can assert that a screen actually reached a
 * native surface (`stub-WebView` for an embed host) instead of merely
 * rendering without throwing. "It did not crash" and "it rendered the thing"
 * are different claims, and this repo has been burned by only being able to
 * make the first one.
 */
import React from 'react'
import { View, type ViewProps } from 'react-native'

export type StubViewProps = ViewProps & Record<string, unknown>

export function makeStubView(name: string): React.ComponentType<StubViewProps> {
  const Stub = ({ children, style }: StubViewProps): React.ReactElement => (
    <View style={style} testID={`stub-${name}`}>
      {children}
    </View>
  )
  Stub.displayName = `Stub(${name})`
  return Stub
}
