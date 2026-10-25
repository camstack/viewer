/**
 * use-host-box — the pixel box an embed page draws its player in.
 *
 * Two authorities, never both at once:
 *
 *  - the HOST, through `fit(w, h)`. The native shells push the WebView's real
 *    frame because WKWebView's `innerHeight` is stale across a rotation. From
 *    the first `fit` on, the host owns the box and a window `resize` changes
 *    nothing.
 *  - the WINDOW, until a host has spoken. A browser host (the PWA's iframe, an
 *    external integration) never calls `fit`; it sizes the iframe and expects
 *    the page to follow it.
 *
 * The page used to read the window ONCE, at mount, and wait for a `fit` that a
 * browser host never sends. The iframe then grew — fullscreen on the hosted PWA,
 * a resized window, the detail switching from its rail to fill — while the
 * player stayed pinned at the size it was born with (operator report
 * 2026-10-07: "fullscreen leaves the camera the same size").
 */
import { useCallback, useEffect, useState } from 'react'

export interface HostBox {
  readonly w: number
  readonly h: number
}

export interface HostBoxState {
  readonly box: HostBox
  /** True once the host has called `fit` — the window is then ignored. */
  readonly hostOwned: boolean
}

/** The state before anyone has spoken: the window's size, window-owned. */
export function initialHostBox(window: HostBox): HostBoxState {
  return { box: window, hostOwned: false }
}

/** The host's `fit`: always wins, and keeps the box from then on. */
export function hostBoxOnFit(_state: HostBoxState, fit: HostBox): HostBoxState {
  return { box: fit, hostOwned: true }
}

/**
 * A window `resize`: followed only while no host has fitted, and only for a
 * real measurement (a 0×0 frame mid-transition is not a size). Returns the SAME
 * state when nothing changes, so React skips the render.
 */
export function hostBoxOnResize(state: HostBoxState, window: HostBox): HostBoxState {
  if (state.hostOwned) return state
  if (!(window.w > 0 && window.h > 0)) return state
  if (window.w === state.box.w && window.h === state.box.h) return state
  return { box: window, hostOwned: false }
}

function windowBox(): HostBox {
  return { w: window.innerWidth, h: window.innerHeight }
}

/** The box, and the `fit` to expose on the page's host API. */
export interface HostBoxHandle {
  readonly box: HostBox
  readonly fit: (w: number, h: number) => void
}

export function useHostBox(): HostBoxHandle {
  const [state, setState] = useState<HostBoxState>(() => initialHostBox(windowBox()))

  useEffect(() => {
    const onResize = (): void => setState((s) => hostBoxOnResize(s, windowBox()))
    window.addEventListener('resize', onResize)
    // A resize between the first render and this effect would otherwise be lost.
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const fit = useCallback((w: number, h: number): void => {
    setState((s) => hostBoxOnFit(s, { w, h }))
  }, [])

  return { box: state.box, fit }
}
