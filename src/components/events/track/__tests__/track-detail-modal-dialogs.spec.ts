/**
 * Source guard for the dialogs a track opens from INSIDE its modal.
 *
 * `TrackDetailModal` is a RN `<Modal>`: on iOS its content lives in a view
 * controller PRESENTED over the root one. The confirm/prompt dialog is itself
 * a `<Modal>`, and the root `ConfirmProvider` presents it from the ROOT view
 * controller — which is already presenting the track modal, so UIKit refuses
 * the second presentation and the dialog never appears. The operator's report:
 * turning the debug flag on, the note prompt "does not show up" and the app
 * hangs there (2026-09-06, v1.0.449/450, exit `vanished`).
 *
 * The fix is structural: a `ConfirmProvider` INSIDE the modal window, so the
 * nearest provider's dialog is presented from the presented controller. This
 * spec holds that nesting shut; the viewer suite has no renderer, so it reads
 * the source in the style of `track-detail-nav-wiring.spec.ts`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('TrackDetailModal — dialogs are presented from the modal window', () => {
  const src = read('components/events/track/TrackDetailModal.tsx')

  it('mounts its own ConfirmProvider inside the sheet\'s window', () => {
    const modalAt = src.indexOf('<SheetModal')
    const providerAt = src.indexOf('<ConfirmProvider>')
    const bodyAt = src.indexOf('<TrackDetailView')
    expect(modalAt).toBeGreaterThan(-1)
    expect(providerAt).toBeGreaterThan(modalAt)
    expect(bodyAt).toBeGreaterThan(providerAt)
    expect(src).toContain("from '../../ui/confirm.js'")
  })
})
