/**
 * RootErrorBoundary — the app's last stop before a render throw becomes a blank
 * screen the operator reads as a crash.
 *
 * ## Why it wraps everything, including the providers
 *
 * `components/ui/RenderErrorBoundary` guards one image. Nothing guarded the
 * TREE, so a throw in any provider or screen unmounted the whole app — and
 * with no `componentDidCatch` anywhere above it, produced no line either. This
 * repo has already shipped that exact failure once: a module-scope
 * `Array.prototype.toSorted` in `rule-editor.ts` (Hermes has never implemented
 * it) took the app down the instant the Notifications tab opened, with 2,917
 * green tests (see `scripts/check-hermes-builtins.mjs`).
 *
 * Because it sits ABOVE `ThemeProvider` — the provider it must survive the
 * failure of — it cannot read theme tokens, so its colours are literal. That is
 * the trade: a fallback that depends on the thing that broke is not a fallback.
 *
 * ## It reports, then it offers a way out
 *
 * The error goes through `reportFatal` — the same path the global handler uses,
 * so there is one shape of crash line whichever way the error arrived — which
 * also leaves the marker `render-error`, so the NEXT launch names it even if
 * the POST never landed. Then it draws a sentence and a Retry that remounts the
 * tree, because a caught render error is frequently transient (a stale query
 * payload, a null the screen did not expect) and a relaunch is a big ask.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { reportFatal } from '../lib/crash-reporter.js'

export interface RootErrorBoundaryProps {
  readonly children: React.ReactNode
}

export interface RootErrorBoundaryState {
  readonly failed: boolean
}

export class RootErrorBoundary extends React.Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  constructor(props: RootErrorBoundaryProps) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    reportFatal('render-error', error)
  }

  private readonly retry = (): void => {
    this.setState({ failed: false })
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <View style={styles.root}>
        <Text style={styles.title}>CamStack</Text>
        <Text style={styles.body}>
          Something went wrong while drawing the screen. The details have been sent to your hub.
        </Text>
        <Pressable style={styles.button} onPress={this.retry}>
          <Text style={styles.buttonLabel}>Retry</Text>
        </Pressable>
      </View>
    )
  }
}

/** Literal, not tokens: this component must render when `ThemeProvider` is the
 *  thing that threw. Dark neutral — the app's own default appearance. */
const styles = StyleSheet.create({
  body: { color: '#A0A0A8', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  button: {
    backgroundColor: '#2F6FEB',
    borderRadius: 10,
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  root: {
    alignItems: 'center',
    backgroundColor: '#0B0B0F',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', marginBottom: 12 },
})
