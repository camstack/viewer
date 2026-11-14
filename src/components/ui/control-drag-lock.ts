/**
 * control-drag-lock — a control that is being dragged owns the touch.
 *
 * A dial, slider or grip inside a device card (a WebView page) cannot see the
 * native gestures around it: the sheet's close-drag (`SheetModal`), the snap
 * sheet's pan (`SnapSheet`) and a scroll view hosting the card all keep
 * listening to the same finger, so dragging a gauge moved the sheet itself.
 *
 * This is the ONE place that says "a control is dragging". The card reports it
 * (`parseControlDragMessage`, fed by `CONTROL_DRAG_BRIDGE_SCRIPT`), a native
 * control can report it directly (`beginControlDrag` / `endControlDrag`), and
 * every surface that pans or scrolls reads {@link useControlDragActive} and
 * turns its gesture off while it is true. Fixed here once, every card benefits.
 */
import { useSyncExternalStore } from 'react'

let active = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** A control started a drag. Pair every call with {@link endControlDrag}. */
export function beginControlDrag(): void {
  active += 1
  if (active === 1) emit()
}

/** The control's drag ended (or the control went away). */
export function endControlDrag(): void {
  if (active === 0) return
  active -= 1
  if (active === 0) emit()
}

export function isControlDragActive(): boolean {
  return active > 0
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** True while any control is being dragged: a pan or scroll must stand down. */
export function useControlDragActive(): boolean {
  return useSyncExternalStore(subscribe, isControlDragActive, isControlDragActive)
}

/** The message a card posts when a control takes or releases the finger. */
export interface ControlDragMessage {
  readonly active: boolean
}

export function parseControlDragMessage(raw: string): ControlDragMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const type: unknown = Reflect.get(parsed, 'type')
    const flag: unknown = Reflect.get(parsed, 'active')
    if (type !== 'control-drag' || typeof flag !== 'boolean') return null
    return { active: flag }
  } catch {
    return null
  }
}

/**
 * Runs inside the card's page. A control that owns its gesture declares
 * `touch-action: none` (dial, grip, slider thumb — the page's own scroll would
 * otherwise take the drag), so that declaration is what marks one: a touch that
 * starts on such an element tells the app, and its end/cancel releases it.
 */
export const CONTROL_DRAG_BRIDGE_SCRIPT =
  `(function(){try{if(window.__csControlDrag)return;window.__csControlDrag=true;` +
  `var on=false;` +
  `function post(a){if(on===a)return;on=a;` +
  `window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'control-drag',active:a}));}` +
  `function owns(el){for(var n=el;n&&n.nodeType===1;n=n.parentElement){` +
  `if(getComputedStyle(n).touchAction==='none')return true;` +
  `var r=n.getAttribute&&n.getAttribute('role');if(r==='slider')return true;}return false;}` +
  `document.addEventListener('touchstart',function(e){if(owns(e.target))post(true);},{capture:true,passive:true});` +
  `['touchend','touchcancel'].forEach(function(t){document.addEventListener(t,function(){post(false);},{capture:true,passive:true});});` +
  `}catch(e){}})(); true;`
