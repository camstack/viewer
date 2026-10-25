/**
 * RenderErrorBoundary — a minimal React error boundary so a render failure in a
 * fragile subtree (e.g. decoding an oversized image inside the zoomable detail
 * hero) shows a fallback instead of unmounting the whole app.
 *
 * A JS error boundary catches errors thrown during a child's RENDER / lifecycle;
 * it cannot catch a native crash (an OOM in the image decoder, a gesture-handler
 * fault). It is the last line of defence layered ON TOP of the memory-safe image
 * sizing + gesture guards — together they keep a bad frame from taking the app
 * down.
 *
 * `resetKey` clears a latched error when the wrapped content changes (a new
 * gallery item gets a fresh attempt). The reset reconciliation is the pure,
 * unit-tested {@link reconcileBoundaryState}.
 */
import React from 'react'

export interface RenderErrorBoundaryState {
  readonly hasError: boolean
  readonly lastResetKey: string | undefined
}

/**
 * Pure reset reconciliation for {@link RenderErrorBoundary}: when `resetKey`
 * changes, clear any latched error and adopt the new key; otherwise keep state.
 * Returns the next state, or null to signal "no change" (React's
 * getDerivedStateFromProps contract). Unit-tested.
 */
export function reconcileBoundaryState(
  state: RenderErrorBoundaryState,
  resetKey: string | undefined,
): RenderErrorBoundaryState | null {
  if (resetKey === state.lastResetKey) return null
  return { hasError: false, lastResetKey: resetKey }
}

export interface RenderErrorBoundaryProps {
  /** Rendered in place of the children once an error is caught. */
  readonly fallback: React.ReactNode
  /** Changing this clears a latched error and re-attempts the children. */
  readonly resetKey?: string
  /** Notified (once) when an error is caught — for diagnostics/logging. */
  readonly onError?: (error: Error) => void
  readonly children: React.ReactNode
}

export class RenderErrorBoundary extends React.Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  constructor(props: RenderErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, lastResetKey: props.resetKey }
  }

  static getDerivedStateFromError(): Partial<RenderErrorBoundaryState> {
    return { hasError: true }
  }

  static getDerivedStateFromProps(
    props: RenderErrorBoundaryProps,
    state: RenderErrorBoundaryState,
  ): RenderErrorBoundaryState | null {
    return reconcileBoundaryState(state, props.resetKey)
  }

  componentDidCatch(error: Error): void {
    this.props.onError?.(error)
  }

  render(): React.ReactNode {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}
