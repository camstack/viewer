/**
 * bridge-channel — how the drawer talks to the one framed app on screen.
 *
 * The frame registers its sender while it is mounted; the drawer sends
 * `navigate` / `search` through here without holding a reference to a webview.
 * `send` says whether a frame took the message.
 */
import type { ShellToAppMessage } from '@camstack/types/client'

type Sender = (message: ShellToAppMessage) => void

let current: Sender | null = null

export const bridgeChannel = {
  /** Register the frame's sender; the returned function detaches it (only if it is still the current one). */
  attach(send: Sender): () => void {
    current = send
    return () => {
      if (current === send) current = null
    }
  },
  send(message: ShellToAppMessage): boolean {
    if (current === null) return false
    current(message)
    return true
  },
}
