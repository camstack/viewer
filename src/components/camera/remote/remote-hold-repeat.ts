/**
 * Hold-to-repeat for the remote's keys, as a real remote does for an arrow or
 * the volume: a tap sends once (the caller's `onPress`), a key held for
 * {@link HOLD_DELAY_MS} keeps sending until it is released.
 *
 * One send is in flight at a time: the next starts only after the previous
 * one's promise settled AND {@link REPEAT_GAP_MS} passed, so a slow hub never
 * builds a backlog behind its per-device lock. A send that did not land
 * (`false`) ends the repeat; so does release, unmount and a disabled key.
 */
import type { RemoteKnownRole } from '@camstack/types'

/** Roles that repeat while held: arrows, volume, channel, seek. Never power, digits, ok, sources or custom keys. */
const REPEATABLE: ReadonlySet<RemoteKnownRole> = new Set<RemoteKnownRole>([
  'up',
  'down',
  'left',
  'right',
  'volume_up',
  'volume_down',
  'channel_up',
  'channel_down',
  'rewind',
  'fast_forward',
])

export const HOLD_DELAY_MS = 400
export const REPEAT_GAP_MS = 150

export function isRepeatableRole(role: string): boolean {
  for (const known of REPEATABLE) if (known === role) return true
  return false
}

export interface HoldRepeaterOptions {
  /** Sends the key once; resolves `true` when the hub took it. */
  readonly send: () => Promise<boolean>
  /** Called before every repeated send (the haptic). */
  readonly onRepeat?: () => void
}

export interface HoldRepeater {
  readonly pressIn: () => void
  readonly pressOut: () => void
  /** True once this press turned into a hold: its release must not also send a tap. */
  readonly held: () => boolean
}

export function createHoldRepeater({ send, onRepeat }: HoldRepeaterOptions): HoldRepeater {
  let timer: ReturnType<typeof setTimeout> | null = null
  let active = false
  let didHold = false
  let generation = 0

  const clear = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  // A release clears the timer, so a pending wait never resolves; the loop is then dropped with its closure.
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      timer = setTimeout(() => {
        timer = null
        resolve()
      }, ms)
    })

  const loop = async (mine: number): Promise<void> => {
    while (active && generation === mine) {
      onRepeat?.()
      let landed = false
      try {
        landed = await send()
      } catch {
        landed = false
      }
      if (!landed || !active || generation !== mine) break
      await wait(REPEAT_GAP_MS)
    }
    if (generation === mine) active = false
  }

  return {
    pressIn: () => {
      clear()
      active = false
      didHold = false
      generation += 1
      const mine = generation
      timer = setTimeout(() => {
        timer = null
        didHold = true
        active = true
        void loop(mine)
      }, HOLD_DELAY_MS)
    },
    pressOut: () => {
      clear()
      active = false
      generation += 1
    },
    held: () => didHold,
  }
}
