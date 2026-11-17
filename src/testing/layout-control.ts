/**
 * Deliver the layout pass jsdom never runs.
 *
 * react-native-web reports `onLayout` through a `ResizeObserver` that jsdom
 * does not have, so a component that sizes itself from `onLayout` (the theater
 * timeline: `scrollWidth`, the viewport height its card band is cut from)
 * stays at zero and draws nothing a test could press. RNW keeps each
 * subscriber's handler on its DOM node under `__reactLayoutHandler`; this calls
 * every one of them with the size a device would have measured.
 *
 * Crude on purpose: every node gets the same box. A spec that needs a
 * geometry assertion must not use it; a spec that needs the subtree to EXIST
 * (a card to tap, a scroller to scroll) can.
 */
import { act } from '@testing-library/react'

const LAYOUT_HANDLER = '__reactLayoutHandler'

interface LayoutEvent {
  readonly nativeEvent: {
    readonly layout: {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly left: number
      readonly top: number
    }
  }
  readonly timeStamp: number
}

type LayoutHandler = (event: LayoutEvent) => void

function layoutHandlerOf(node: Element): LayoutHandler | null {
  const handler: unknown = Reflect.get(node, LAYOUT_HANDLER)
  if (typeof handler !== 'function') return null
  return (event) => {
    handler.call(node, event)
  }
}

/**
 * Lay out every node under `root` at `width` × `height`. A layout can mount
 * new subscribers (a card band appears once the width is known), so the pass
 * repeats until no new handler shows up, bounded by `maxPasses`.
 */
export function deliverLayout(
  root: ParentNode,
  size: { readonly width: number; readonly height: number },
  maxPasses = 4,
): void {
  const event: LayoutEvent = {
    nativeEvent: { layout: { x: 0, y: 0, width: size.width, height: size.height, left: 0, top: 0 } },
    timeStamp: 0,
  }
  const seen = new Set<Element>()
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const fresh = [...root.querySelectorAll('*')].filter((n) => !seen.has(n) && layoutHandlerOf(n) !== null)
    if (fresh.length === 0) return
    act(() => {
      for (const node of fresh) {
        seen.add(node)
        layoutHandlerOf(node)?.(event)
      }
    })
  }
}
