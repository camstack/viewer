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
 * also leaves the marker `render-error` (message, JS stack and the React
 * component stack), so the NEXT launch ships it as `previous runtime exit` even
 * when the POST never landed. A throw before the first connect has no hub to
 * POST to, so the screen says "saved on this device", never "sent", and shows
 * the message itself. Then it draws a sentence and a Retry that remounts the
 * tree, because a caught render error is frequently transient (a stale query
 * payload, a null the screen did not expect) and a relaunch is a big ask.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { describeThrown } from '../lib/crash-record.js'
import { reportFatal } from '../lib/crash-reporter.js'

export interface RootErrorBoundaryProps {
  readonly children: React.ReactNode
}

export interface RootErrorBoundaryState {
  readonly failed: boolean
  /** What was thrown, shown small under the sentence so the operator can read it out. */
  readonly detail: string | null
}

/** The line under the sentence: the error, bounded so a long message cannot fill the screen. */
export const BOUNDARY_DETAIL_MAX_CHARS = 300

export function boundaryDetail(error: unknown): string {
  return describeThrown(error).message.slice(0, BOUNDARY_DETAIL_MAX_CHARS)
}

export class RootErrorBoundary extends React.Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  constructor(props: RootErrorBoundaryProps) {
    super(props)
    this.state = { failed: false, detail: null }
  }

  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    return { failed: true, detail: boundaryDetail(error) }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportFatal('render-error', error, undefined, info.componentStack)
  }

  private readonly retry = (): void => {
    this.setState({ failed: false, detail: null })
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <View style={styles.root}>
        <Text style={styles.title}>CamStack</Text>
        <Text style={styles.body}>
          Something went wrong while drawing the screen. The details are saved on this device and
          are sent to your hub the next time the app connects.
        </Text>
        {this.state.detail === null ? null : (
          <Text style={styles.detail} selectable testID="root-error-detail">
            {this.state.detail}
          </Text>
        )}
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
  body: { color: '#A0A0A8', fontSize: 14, lineHeight: 20, textAlign: 'center' }, // ui-check-ok: above ThemeProvider, cannot read tokens
  button: {
    backgroundColor: '#2F6FEB', // ui-check-ok: above ThemeProvider, cannot read tokens
    borderRadius: 10,
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' }, // ui-check-ok: above ThemeProvider, cannot read tokens
  detail: { color: '#A0A0A8', opacity: 0.8, fontSize: 12, lineHeight: 16, marginTop: 12, textAlign: 'center' }, // ui-check-ok: above ThemeProvider, cannot read tokens
  root: {
    alignItems: 'center',
    backgroundColor: '#0B0B0F', // ui-check-ok: above ThemeProvider, cannot read tokens
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', marginBottom: 12 }, // ui-check-ok: above ThemeProvider, cannot read tokens
})
